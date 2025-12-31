import { ModalSubmitInteraction } from "discord.js";

import { prisma } from "#root/index.js";
import { Component } from "#classes/Component.js";

import type { InteractionReplyData } from "#utils/Types.js";

import BanRequestUtils from "#utils/BanRequests.js";

const AUTO_DELETE_DELAY = 7000;

export default class BanRequestModal extends Component {
	public constructor() {
		super({ matches: /^ban-request-(accept|deny)-\d{17,19}$/m });
	}

	public async run(interaction: ModalSubmitInteraction<"cached">): Promise<InteractionReplyData | null> {
		const config = await prisma.banRequestConfig.findUnique({
			where: { id: interaction.guild.id }
		});

		if (!config?.enabled || !config.webhook_url) {
			return { error: "Ban requests are not configured for this server." };
		}

		const action = interaction.customId.split("-")[2] as "accept" | "deny";
		const requestId = interaction.customId.split("-")[3];

		const request = await prisma.banRequest.findUnique({
			where: { id: requestId, guild_id: interaction.guild.id }
		});

		if (!request) {
			setTimeout(() => interaction.message?.delete().catch(() => null), AUTO_DELETE_DELAY);
			return {
				error: "Failed to find the ban request associated with this message. I will attempt to delete this submission in 7 seconds."
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
