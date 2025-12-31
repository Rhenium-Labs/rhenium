import { ButtonInteraction, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { prisma } from "#root/index.js";
import { Component } from "#classes/Component.js";
import { userMentionWithId } from "#utils/index.js";

import type { InteractionReplyData } from "#utils/Types.js";

import BanRequestUtils, { BanRequestAction } from "#utils/BanRequests.js";

const AUTO_DELETE_DELAY = 7000;

export default class BanRequestButton extends Component {
	public constructor() {
		super({ matches: /^ban-request-(accept|deny|disregard)$/m });
	}

	public async run(interaction: ButtonInteraction<"cached">): Promise<InteractionReplyData | null> {
		const config = await prisma.banRequestConfig.findUnique({
			where: { id: interaction.guild.id }
		});

		if (!config?.enabled || !config.webhook_url) {
			return { error: "Ban requests are not configured for this server." };
		}

		const action = interaction.customId.split("-")[2] as BanRequestAction;
		const request = await prisma.banRequest.findUnique({
			where: { id: interaction.message.id, guild_id: interaction.guild.id }
		});

		if (!request) {
			this._scheduleMessageDeletion(interaction);
			return {
				error: "Failed to find the ban request associated with this message. I will attempt to delete this submission in 7 seconds."
			};
		}

		if (request.resolved_by) {
			this._scheduleMessageDeletion(interaction);
			return {
				error: `This request has already been resolved by ${userMentionWithId(request.resolved_by)}. I will attempt to delete this submission in 7 seconds.`
			};
		}

		if (action === BanRequestAction.Disregard) {
			return BanRequestUtils.disregard({ interaction, request });
		}

		const requiresReason =
			(action === BanRequestAction.Accept && config.enforce_accept_reason) ||
			(action === BanRequestAction.Deny && config.enforce_deny_reason);

		if (requiresReason) {
			await interaction.showModal(buildReasonModal(request.id, action));
			return null;
		}

		return BanRequestUtils.process({
			interaction,
			config,
			action,
			request,
			reviewReason: null
		});
	}

	private _scheduleMessageDeletion(interaction: ButtonInteraction<"cached">): void {
		setTimeout(() => interaction.message.delete().catch(() => null), AUTO_DELETE_DELAY);
	}
}

/**
 * Builds a modal for collecting a reason for the ban request action.
 */
function buildReasonModal(requestId: string, action: "accept" | "deny"): ModalBuilder {
	const reasonInput = new TextInputBuilder()
		.setCustomId("reason")
		.setStyle(TextInputStyle.Paragraph)
		.setMaxLength(1024)
		.setMinLength(1)
		.setRequired(true);

	const reasonLabel = new LabelBuilder().setLabel("Reason").setTextInputComponent(reasonInput);

	return new ModalBuilder()
		.setCustomId(`ban-request-${action}-${requestId}`)
		.setTitle(`${action === "accept" ? "Accept" : "Deny"} Ban Request`)
		.addLabelComponents(reasonLabel);
}
