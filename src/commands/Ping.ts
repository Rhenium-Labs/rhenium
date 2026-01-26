import { ApplicationCommandType, ApplicationIntegrationType, InteractionContextType } from "discord.js";

import { ApplyOptions, Command } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

@ApplyOptions<Command.Options>({
	name: "ping",
	description: "Get the websocket heartbeat and roundtrip latency."
})
export default class Ping extends Command {
	public register(): Command.Data {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			contexts: [InteractionContextType.Guild]
		};
	}

	public async interactionRun(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const start = performance.now();
		await interaction.deferReply();
		const end = performance.now();

		const ws = this.client.ws.ping;
		const timeTaken = Math.round(end - start);

		return {
			content: `Pong! Roundtrip took: ${timeTaken}ms. Heartbeat: ${ws}ms.`
		};
	}
}
