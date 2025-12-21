import {
	ActionRowBuilder,
	ApplicationCommandData,
	ApplicationCommandType,
	ApplicationIntegrationType,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	InteractionContextType
} from "discord.js";

import { Command } from "#classes/Command.js";
import { InteractionReplyData } from "#utils/Types.js";

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

		const button = new ButtonBuilder()
			.setLabel("Ping?")
			.setEmoji("🏓")
			.setStyle(ButtonStyle.Secondary)
			.setCustomId("ping");

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

		return {
			content: `Pong! Roundtrip took: ${timeTaken}ms. Heartbeat: ${ws}ms.`,
			components: [row]
		};
	}
}
