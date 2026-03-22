import {
	type ApplicationCommandData,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType
} from "discord.js";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "#commands/Command.js";

export default class Ping extends Command {
	constructor() {
		super({
			name: "ping",
			category: CommandCategory.Utility,
			description: "Get the websocket heartbeat and roundtrip latency."
		});
	}

	override register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			contexts: [InteractionContextType.Guild]
		};
	}

	override async executeInteraction({
		interaction
	}: CommandExecutionContext<"chatInputCmd">): Promise<ResponseData<"interaction">> {
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
