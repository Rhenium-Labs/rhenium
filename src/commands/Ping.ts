import {
	type ChatInputCommandInteraction,
	type ApplicationCommandData,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType
} from "discord.js";

import type { InteractionReplyData } from "#utils/Types.js";

import Command from "#classes/Command.js";

export default class Ping extends Command {
	public constructor() {
		super({
			name: "ping",
			description: "Get the websocket heartbeat and roundtrip latency."
		});
	}

	public register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			contexts: [InteractionContextType.Guild]
		};
	}

	public async interactionRun(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
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
