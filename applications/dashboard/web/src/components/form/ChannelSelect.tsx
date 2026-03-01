import { Hash, Volume2, Megaphone, MessageSquare } from "lucide-react";
import { GuildService } from "@/service/guild";
import { cn } from "@/lib/utils";

interface ChannelSelectProps {
	guildId: string;
	value: string | null;
	onChange: (channelId: string | null) => void;
	label?: string;
	placeholder?: string;
	filterTypes?: number[];
}

const CHANNEL_TYPE_ICONS: Record<number, typeof Hash> = {
	0: Hash,
	2: Volume2,
	5: Megaphone,
	15: MessageSquare,
};

export function ChannelSelect({
	guildId,
	value,
	onChange,
	label,
	placeholder = "Select a channel",
	filterTypes,
}: ChannelSelectProps) {
	const { data: channels, isLoading } = GuildService.useChannels(guildId);

	const filtered = filterTypes
		? channels?.filter((c) => filterTypes.includes(c.type))
		: channels;

	return (
		<div className="space-y-1.5">
			{label && (
				<label className="text-xs font-medium uppercase tracking-wider text-discord-muted">
					{label}
				</label>
			)}
			<select
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value || null)}
				disabled={isLoading}
				className={cn(
					"w-full rounded-md border border-discord-divider bg-discord-sidebar px-3 py-2 text-sm text-discord-text",
					"focus:outline-none focus:ring-1 focus:ring-discord-blurple",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
			>
				<option value="">{isLoading ? "Loading..." : placeholder}</option>
				{filtered?.map((channel) => (
					<option key={channel.id} value={channel.id}>
						# {channel.name}
					</option>
				))}
			</select>
		</div>
	);
}
