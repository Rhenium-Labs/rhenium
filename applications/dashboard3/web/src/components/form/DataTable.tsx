import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Column<T> {
	key: string;
	header: string;
	render: (row: T) => ReactNode;
	className?: string;
}

interface DataTableProps<T> {
	columns: Column<T>[];
	data: T[];
	emptyMessage?: string;
	keyExtractor: (row: T) => string;
}

export function DataTable<T>({
	columns,
	data,
	emptyMessage = "No data",
	keyExtractor,
}: DataTableProps<T>) {
	if (data.length === 0) {
		return (
			<div className="rounded-lg border border-discord-divider bg-discord-panel p-6 text-center text-sm text-discord-muted">
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-discord-divider">
			<table className="w-full">
				<thead>
					<tr className="border-b border-discord-divider bg-discord-sidebar">
						{columns.map((col) => (
							<th
								key={col.key}
								className={cn(
									"px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-discord-muted",
									col.className,
								)}
							>
								{col.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{data.map((row) => (
						<tr
							key={keyExtractor(row)}
							className="border-b border-discord-divider bg-discord-panel last:border-0 hover:bg-discord-hover/50"
						>
							{columns.map((col) => (
								<td
									key={col.key}
									className={cn(
										"px-4 py-2.5 text-sm text-discord-text",
										col.className,
									)}
								>
									{col.render(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
