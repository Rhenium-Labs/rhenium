import { ModalSubmitInteraction } from "discord.js";

import { prisma } from "#root/index.js";
import { Component } from "#classes/Component.js";

import type { InteractionReplyData } from "#utils/Types.js";

import BanRequestUtils from "#utils/BanRequests.js";

export default class BanRequestModal extends Component {
	public constructor() {
		super({ matches: /^ban-request-(accept|deny)-\d{17,19}$/m });
	}

	public async run(interaction: ModalSubmitInteraction<"cached">): Promise<InteractionReplyData | null> {
		const config = await prisma.banRequestConfig.findUnique({
			where: { id: interaction.guild.id }
		});

		if (!config || !config.enabled || !config.webhook_url) {
			return {
				error: `Ban requests are not configured for this server.`
			};
		}

		const action = interaction.customId.split("-")[2] as "accept" | "deny";
		const requestID = interaction.customId.split("-")[3];

		const request = await prisma.banRequest.findUnique({
			where: { id: requestID, guild_id: interaction.guild.id }
		});

		if (!request) {
			setTimeout(async () => {
				await interaction.message?.delete().catch(() => null);
			}, 7000);

			return {
				error: `Failed to find the ban request associated with this message. I will attempt to delete this submission in 7 seconds.`
			};
		}

		const reviewReason = interaction.fields.getTextInputValue("reason");
		return BanRequestUtils.process({
			interaction,
			config,
			action,
			request,
			reviewReason
		});
	}
}
