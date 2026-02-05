import type {
	KyselyPlugin,
	PluginTransformQueryArgs,
	PluginTransformResultArgs,
	RootOperationNode,
	UnknownRow,
	QueryResult
} from "kysely";

import ConfigManager, { ConfigKeys } from "#config/ConfigManager.js";

type QueryMetadata = {
	tableName: string;
	guildId: string | null;
};

export default class ConfigCacheInvalidatorPlugin implements KyselyPlugin {
	/**
	 * A mapping of query IDs to their associated metadata.
	 * Used to track which guild's configuration needs to be invalidated
	 * after a mutating operation.
	 *
	 * We use a WeakMap to avoid memory leaks, as query IDs are objects
	 * that may be garbage collected after the query is complete.
	 */
	private _queryMetadata = new WeakMap<object, QueryMetadata>();

	/**
	 * Extracts and stores metadata about mutating queries.
	 *
	 * @param args The plugin transform query arguments.
	 * @returns The root operation node.
	 */

	transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
		const { node, queryId } = args;

		const tableName = this._extractTableName(node);

		if (!tableName || !this._isTrackedTable(tableName)) {
			return node;
		}

		// Only track mutating operations
		const operation = node.kind;

		if (!["UpdateQueryNode", "InsertQueryNode", "DeleteQueryNode"].includes(operation)) {
			return node;
		}

		// Skip INSERT...ON CONFLICT (upsert) patterns to avoid infinite loops.
		// These are used in ConfigManager.reload() to ensure rows exist.
		if (operation === "InsertQueryNode" && "onConflict" in node && node.onConflict) {
			return node;
		}

		const guildId = this._extractGuildId(node, tableName);

		if (guildId) {
			this._queryMetadata.set(queryId, { tableName, guildId });
		}

		return node;
	}

	/**
	 * Invalidates the configuration cache after mutating operations.
	 *
	 * @param args The plugin transform result arguments.
	 * @returns The query result.
	 */

	async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
		const { queryId, result } = args;

		const metadata = this._queryMetadata.get(queryId);
		this._queryMetadata.delete(queryId);

		if (!metadata || !metadata.guildId) {
			return result;
		}

		const configKey = this._getConfigKey(metadata.tableName);

		if (configKey) {
			// Reload the configuration for the affected guild and config key.
			void ConfigManager.reload(metadata.guildId, configKey);
		}

		return result;
	}

	private _extractTableName(node: RootOperationNode): string | null {
		if ("table" in node && node.table) {
			const tableNode = node.table as any;

			if (tableNode.table?.identifier?.name) {
				return tableNode.table.identifier.name;
			}
		}

		if ("into" in node && node.into) {
			const intoNode = node.into as any;

			if (intoNode.table?.identifier?.name) {
				return intoNode.table.identifier.name;
			}
		}

		if ("from" in node && node.from) {
			const fromNode = node.from as any;

			if (fromNode.froms?.[0]?.table?.identifier?.name) {
				return fromNode.froms[0].table.identifier.name;
			}
		}

		return null;
	}

	private _extractGuildId(node: RootOperationNode, tableName: string): string | null {
		// Config tables use the `id` column as the guild id.
		// Scoping related tables use the `guild_id` column.
		const idColumn = TablesWithIdPrimaryKey.includes(tableName as any) ? "id" : "guild_id";

		// Try to extract from WHERE clause (for UPDATE/DELETE)
		if ("where" in node && node.where) {
			const guildId = this._extractValueFromWhere(node.where, idColumn);
			if (guildId) return guildId;
		}

		// Try to extract from VALUES (for INSERT)
		if ("values" in node && node.values) {
			const columns = "columns" in node ? (node.columns as any[]) : null;
			const guildId = this._extractValueFromInsert(node.values, columns, idColumn);
			if (guildId) return guildId;
		}

		return null;
	}

	private _extractValueFromWhere(whereNode: any, columnName: string): string | null {
		if (!whereNode) return null;

		// Handle WhereNode wrapper
		if (whereNode.kind === "WhereNode" && whereNode.where) {
			return this._extractValueFromWhere(whereNode.where, columnName);
		}

		// Handle BinaryOperationNode (e.g., id = 'value')
		if (whereNode.kind === "BinaryOperationNode") {
			const left = whereNode.leftOperand;
			const right = whereNode.rightOperand;
			const op = whereNode.operator;

			// Check if this is a comparison with our target column
			if (op?.operator === "=" && left?.kind === "ReferenceNode") {
				const colName = left.column?.column?.name;
				if (colName === columnName && right?.kind === "ValueNode") {
					return String(right.value);
				}
			}
		}

		// Handle AndNode - recursively check both sides
		if (whereNode.kind === "AndNode") {
			const leftResult = this._extractValueFromWhere(whereNode.left, columnName);
			if (leftResult) return leftResult;
			return this._extractValueFromWhere(whereNode.right, columnName);
		}

		// Handle OrNode - recursively check both sides
		if (whereNode.kind === "OrNode") {
			const leftResult = this._extractValueFromWhere(whereNode.left, columnName);
			if (leftResult) return leftResult;
			return this._extractValueFromWhere(whereNode.right, columnName);
		}

		return null;
	}

	private _extractValueFromInsert(
		valuesNode: any,
		columns: any[] | null,
		columnName: string
	): string | null {
		if (!valuesNode) return null;

		// Handle ValuesNode with items array
		const items = valuesNode.values;
		if (!Array.isArray(items) || items.length === 0) return null;

		// Get first row of values
		const firstRow = items[0];

		// Handle both PrimitiveValueListNode and ValueListNode
		if (firstRow?.kind !== "PrimitiveValueListNode" && firstRow?.kind !== "ValueListNode") {
			return null;
		}

		const values = firstRow.values;
		if (!Array.isArray(values)) return null;

		// If we have columns, find by index
		if (columns && columns.length > 0) {
			// Column structure: { kind: "ColumnNode", column: { kind: "IdentifierNode", name: "guild_id" } }
			const columnIndex = columns.findIndex(
				(col: any) => col?.column?.name === columnName
			);
			if (columnIndex === -1 || columnIndex >= values.length) return null;

			const targetValue = values[columnIndex];

			// PrimitiveValueListNode contains raw values (strings, numbers, etc.)
			// ValueListNode contains ValueNode objects
			if (firstRow.kind === "PrimitiveValueListNode") {
				return targetValue != null ? String(targetValue) : null;
			} else if (targetValue?.kind === "ValueNode" && targetValue.value != null) {
				return String(targetValue.value);
			}
		}

		return null;
	}

	private _isTrackedTable(tableName: string): boolean {
		return (
			TablesWithIdPrimaryKey.includes(
				tableName as (typeof TablesWithIdPrimaryKey)[number]
			) || TablesWithGuildId.includes(tableName as (typeof TablesWithGuildId)[number])
		);
	}

	private _getConfigKey(tableName: string): ConfigKeys | null {
		return GuildIdToConfigKey[tableName] ?? IdPrimaryKeyToConfigKey[tableName] ?? null;
	}
}

/** Tables that have a "guild_id" column. */
const TablesWithGuildId = [
	"QuickMuteChannelScoping",
	"QuickPurgeChannelScoping",
	"ContentFilterChannelScoping",
	"PermissionScope",
	"LoggingWebhook"
] as const;

/** Tables that use their "id" column as the primary key. */
const TablesWithIdPrimaryKey = [
	"MessageReportConfig",
	"BanRequestConfig",
	"QuickMuteConfig",
	"QuickPurgeConfig",
	"ContentFilterConfig",
	"HighlightConfig"
] as const;

/** Mapping of table names to ConfigKeys for tables with "guild_id" column. */
const GuildIdToConfigKey: Record<string, ConfigKeys> = {
	QuickMuteChannelScoping: ConfigKeys.QuickMutes,
	QuickPurgeChannelScoping: ConfigKeys.QuickPurges,
	ContentFilterChannelScoping: ConfigKeys.ContentFilter,
	PermissionScope: ConfigKeys.PermissionScopes,
	LoggingWebhook: ConfigKeys.LoggingWebhooks
};

/** Mapping of table names to ConfigKeys for tables with "id" primary key. */
const IdPrimaryKeyToConfigKey: Record<string, ConfigKeys> = {
	MessageReportConfig: ConfigKeys.MessageReports,
	BanRequestConfig: ConfigKeys.BanRequests,
	QuickMuteConfig: ConfigKeys.QuickMutes,
	QuickPurgeConfig: ConfigKeys.QuickPurges,
	ContentFilterConfig: ConfigKeys.ContentFilter,
	HighlightConfig: ConfigKeys.Highlights
};
