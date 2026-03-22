import type {
	KyselyPlugin,
	PluginTransformQueryArgs,
	PluginTransformResultArgs,
	RootOperationNode,
	UnknownRow,
	QueryResult
} from "kysely";

import ConfigManager from "#config/ConfigManager.js";

type QueryMetadata = { guildId: string };

export default class ConfigCacheInvalidatorPlugin implements KyselyPlugin {
	/**
	 * A mapping of query IDs to their associated metadata.
	 * Used to track which guild's configuration needs to be invalidated
	 * after a mutating operation on the Guild table's config column.
	 *
	 * We use a WeakMap to avoid memory leaks, as query IDs are objects
	 * that may be garbage collected after the query is complete.
	 */
	private _queryMetadata = new WeakMap<object, QueryMetadata>();

	/**
	 * Extracts and stores metadata about mutating queries to the Guild table.
	 *
	 * @param args The plugin transform query arguments.
	 * @returns The root operation node.
	 */

	transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
		const { node, queryId } = args;

		const tableName = this._extractTableName(node);
		if (tableName !== "Guild") return node;

		const operation = node.kind;
		if (!["UpdateQueryNode", "InsertQueryNode"].includes(operation)) return node;

		const guildId = this._extractGuildId(node);
		if (guildId) this._queryMetadata.set(queryId, { guildId });

		return node;
	}

	/**
	 * Invalidates the configuration cache after mutating operations to the Guild table.
	 *
	 * @param args The plugin transform result arguments.
	 * @returns The query result.
	 */

	async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
		const { queryId, result } = args;

		const metadata = this._queryMetadata.get(queryId);
		if (!metadata) return result;

		this._queryMetadata.delete(queryId);

		// Trigger a reload of the guild's configuration to invalidate the cache.
		void ConfigManager.reload(metadata.guildId);
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

		return null;
	}

	private _extractGuildId(node: RootOperationNode): string | null {
		// Try to extract from WHERE clause (for UPDATE)
		if ("where" in node && node.where) {
			const guildId = this._extractValueFromWhere(node.where, "id");
			if (guildId) return guildId;
		}

		// Try to extract from VALUES (for INSERT)
		if ("values" in node && node.values) {
			const columns = "columns" in node ? (node.columns as any[]) : null;
			const guildId = this._extractValueFromInsert(node.values, columns, "id");
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
}
