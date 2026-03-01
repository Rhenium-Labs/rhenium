import { useNavigate, useParams } from "react-router";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { BaseIcon } from "./BaseIcon";
import { GuildService } from "@/service/guild";
import { useGuildStore } from "@/stores/guild";

export function ServerStrip() {
	const navigate = useNavigate();
	const { guildId } = useParams<{ guildId: string }>();
	const { setGuild } = useGuildStore();
	const { data: guilds } = GuildService.useUserGuilds();

	const allServers = guilds ?? [];

	return (
		<TooltipProvider delayDuration={400}>
			<div className="flex w-sidebar-icon shrink-0 flex-col items-center gap-2 py-3">
				<div className="flex flex-1 flex-col gap-2 overflow-y-auto scrollbar-thin">
					<BaseIcon variant="app" onClick={() => navigate("/home")} />
					{allServers.map((server) => (
						<Tooltip key={server.id}>
							<TooltipTrigger asChild>
								<span className="flex shrink-0 justify-center">
									<BaseIcon
										variant="server"
										icon={server.icon}
										alt={server.name}
										isActive={guildId === server.id}
										muted={!server.whitelisted}
										onClick={() => {
											if (server.whitelisted) {
												setGuild({
													id: server.id,
													name: server.name,
													icon: server.icon,
												});
												navigate(`/guilds/${server.id}`);
											} else {
												navigate("/home");
											}
										}}
									/>
								</span>
							</TooltipTrigger>
							<TooltipContent side="right" className="flex flex-col gap-0.5">
								<span className="font-medium text-discord-text">
									{server.name}
								</span>
								{!server.whitelisted && (
									<span className="text-xs text-discord-muted">
										Not configured
									</span>
								)}
							</TooltipContent>
						</Tooltip>
					))}
				</div>
			</div>
		</TooltipProvider>
	);
}
