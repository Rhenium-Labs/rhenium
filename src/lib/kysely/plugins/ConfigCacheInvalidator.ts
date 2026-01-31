import type {
	KyselyPlugin,
	PluginTransformQueryArgs,
	PluginTransformResultArgs,
	RootOperationNode,
	UnknownRow,
	QueryResult
} from "kysely";

import ConfigManager, { ConfigKeys } from "#config/ConfigManager.js";

interface QueryMetadata {
	tableName: string;
	guildId: string | null;
}

export default class ConfigCacheInvalidatorPlugin implements KyselyPlugin {
	/**
	 * A mapping of query IDs to their associated metadata.
	 * Used to track which guild's configuration needs to be invalidated
	 * after a mutating operation.
	 *
	 * We use a WeakMap to avoid memory leaks, as query IDs are objects
	 * that may be garbage collected after the query is complete.
	 */
	private queryMetadata = new WeakMap<object, QueryMetadata>();

	/**
	 * Extracts and stores metadata about mutating queries.
	 *
	 * @param args The plugin transform query arguments.
	 * @returns The root operation node.
	 */

	public transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
		const { node, queryId } = args;

		const tableName = this.extractTableName(node);

		if (!tableName || !this.isTrackedTable(tableName)) {
			return node;
		}

		// Only track mutating operations
		const operation = node.kind;

		if (!["UpdateQueryNode", "InsertQueryNode", "DeleteQueryNode"].includes(operation)) {
			return node;
		}

		const guildId = this.extractGuildId(node, tableName);

		if (guildId) {
			this.queryMetadata.set(queryId, { tableName, guildId });
		}

		return node;
	}

	/**
	 * Invalidates the configuration cache after mutating operations.
	 *
	 * @param args The plugin transform result arguments.
	 * @returns The query result.
	 */

	public async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
		const { queryId, result } = args;

		const metadata = this.queryMetadata.get(queryId);
		this.queryMetadata.delete(queryId);

		if (!metadata || !metadata.guildId) {
			return result;
		}

		const configKey = this.getConfigKey(metadata.tableName);

		if (configKey) {
			// Invalidate the cache for this guild and config key.
			void ConfigManager.invalidateKey(metadata.guildId, configKey);
		}

		return result;
	}

	private extractTableName(node: RootOperationNode): string | null {
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

	private extractGuildId(node: RootOperationNode, tableName: string): string | null {
		// For config tables, the 'id' column IS the guild_id
		// For channel scoping tables, there's an explicit 'guild_id' column
		const idColumn = CachedModels.includes(tableName as any) ? "id" : "guild_id";

		// Try to extract from WHERE clause (for UPDATE/DELETE)
		if ("where" in node && node.where) {
			const guildId = this.extractValueFromWhere(node.where, idColumn);
			if (guildId) return guildId;
		}

		// Try to extract from VALUES (for INSERT)
		if ("values" in node && node.values && "columns" in node && node.columns) {
			const guildId = this.extractValueFromInsert(node.values, node.columns as any[], idColumn);
			if (guildId) return guildId;
		}

		return null;
	}

	private extractValueFromWhere(whereNode: any, columnName: string): string | null {
		if (!whereNode) return null;

		// Handle WhereNode wrapper
		if (whereNode.kind === "WhereNode" && whereNode.where) {
			return this.extractValueFromWhere(whereNode.where, columnName);
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
			const leftResult = this.extractValueFromWhere(whereNode.left, columnName);
			if (leftResult) return leftResult;
			return this.extractValueFromWhere(whereNode.right, columnName);
		}

		// Handle OrNode - recursively check both sides
		if (whereNode.kind === "OrNode") {
			const leftResult = this.extractValueFromWhere(whereNode.left, columnName);
			if (leftResult) return leftResult;
			return this.extractValueFromWhere(whereNode.right, columnName);
		}

		return null;
	}

	private extractValueFromInsert(valuesNode: any, columns: any[], columnName: string): string | null {
		if (!valuesNode || !columns) return null;

		// Find the index of our target column
		const columnIndex = columns.findIndex((col: any) => col?.column?.column?.name === columnName);
		if (columnIndex === -1) return null;

		// Handle ValuesNode with items array
		const items = valuesNode.values;
		if (!Array.isArray(items) || items.length === 0) return null;

		// Get first row of values (PrimitiveValueListNode)
		const firstRow = items[0];
		if (firstRow?.kind !== "PrimitiveValueListNode") return null;

		const values = firstRow.values;
		if (!Array.isArray(values) || columnIndex >= values.length) return null;

		// Get the value at the same index as our column
		const targetValue = values[columnIndex];
		if (targetValue?.kind === "ValueNode" && targetValue.value != null) {
			return String(targetValue.value);
		}

		return null;
	}

	private isTrackedTable(tableName: string): boolean {
		return (
			CachedModels.includes(tableName as (typeof CachedModels)[number]) ||
			ChannelScopingModels.includes(tableName as (typeof ChannelScopingModels)[number])
		);
	}

	private getConfigKey(tableName: string): ConfigKeys | null {
		return ModelToConfigKeys[tableName] ?? ChannelScopingToConfigKey[tableName] ?? null;
	}
}

const CachedModels = [
	"MessageReportConfig",
	"BanRequestConfig",
	"QuickMuteConfig",
	"QuickPurgeConfig",
	"ContentFilterConfig",
	"HighlightConfig",
	"PermissionScope"
] as const;

const ChannelScopingModels = [
	"QuickMuteChannelScoping",
	"QuickPurgeChannelScoping",
	"ContentFilterChannelScoping"
] as const;

const ChannelScopingToConfigKey: Record<string, ConfigKeys> = {
	QuickMuteChannelScoping: ConfigKeys.QuickMutes,
	QuickPurgeChannelScoping: ConfigKeys.QuickPurges,
	ContentFilterChannelScoping: ConfigKeys.ContentFilter
};

const ModelToConfigKeys: Record<string, ConfigKeys> = {
	MessageReportConfig: ConfigKeys.MessageReports,
	BanRequestConfig: ConfigKeys.BanRequests,
	QuickMuteConfig: ConfigKeys.QuickMutes,
	QuickPurgeConfig: ConfigKeys.QuickPurges,
	ContentFilterConfig: ConfigKeys.ContentFilter,
	HighlightConfig: ConfigKeys.Highlights,
	PermissionScope: ConfigKeys.PermissionScopes
};
