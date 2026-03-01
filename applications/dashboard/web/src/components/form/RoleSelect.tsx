import { GuildService } from "@/service/guild";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface RoleSelectProps {
	guildId: string;
	value: string[];
	onChange: (roleIds: string[]) => void;
	label?: string;
	placeholder?: string;
}

function intToHex(color: number): string | undefined {
	if (color === 0) return undefined;
	return `#${color.toString(16).padStart(6, "0")}`;
}

export function RoleSelect({
	guildId,
	value,
	onChange,
	label,
	placeholder = "Add a role...",
}: RoleSelectProps) {
	const { data: roles, isLoading } = GuildService.useRoles(guildId);

	const selected = roles?.filter((r) => value.includes(r.id)) ?? [];
	const available = roles?.filter((r) => !value.includes(r.id)) ?? [];

	return (
		<div className="space-y-1.5">
			{label && (
				<label className="text-xs font-medium uppercase tracking-wider text-discord-muted">
					{label}
				</label>
			)}
			{selected.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{selected.map((role) => (
						<span
							key={role.id}
							className="flex items-center gap-1 rounded-full border border-discord-divider px-2 py-0.5 text-xs font-medium"
							style={{ color: intToHex(role.color) }}
						>
							{role.name}
							<button
								type="button"
								onClick={() => onChange(value.filter((id) => id !== role.id))}
								className="rounded-full p-0.5 text-discord-muted transition-colors hover:text-discord-text"
							>
								<X className="size-3" />
							</button>
						</span>
					))}
				</div>
			)}
			<select
				value=""
				onChange={(e) => {
					if (e.target.value) {
						onChange([...value, e.target.value]);
					}
				}}
				disabled={isLoading || available.length === 0}
				className={cn(
					"w-full rounded-md border border-discord-divider bg-discord-sidebar px-3 py-2 text-sm text-discord-text",
					"focus:outline-none focus:ring-1 focus:ring-discord-blurple",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
			>
				<option value="">
					{isLoading ? "Loading..." : available.length === 0 ? "All roles selected" : placeholder}
				</option>
				{available.map((role) => (
					<option key={role.id} value={role.id}>
						{role.name}
					</option>
				))}
			</select>
		</div>
	);
}
