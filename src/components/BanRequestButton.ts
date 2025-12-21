import { ButtonInteraction, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { prisma } from "#root/index.js";
import { Component } from "#classes/Component.js";
import { userMentionWithId } from "#utils/index.js";
import { InteractionReplyData } from "#utils/Types.js";

import BanRequestUtils, { BanRequestAction } from "#utils/BanRequests.js";

export default class BanRequestButton extends Component {
	public constructor() {
		super({ matches: /^ban-request-(accept|deny|disregard)$/m });
	}

	public async run(interaction: ButtonInteraction<"cached">): Promise<InteractionReplyData | null> {
		const config = await prisma.banRequestConfig.findUnique({
			where: { id: interaction.guild.id }
		});

		if (!config || !config.enabled || !config.webhook_url) {
			return {
				error: `Ban requests are not configured for this server.`
			};
		}

		const action = interaction.customId.split("-")[2] as BanRequestAction;
		const request = await prisma.banRequest.findUnique({
			where: { id: interaction.message.id, guild_id: interaction.guild.id }
		});

		if (!request) {
			setTimeout(async () => {
				await interaction.message.delete().catch(() => null);
			}, 7000);

			return {
				error: `Failed to find the ban request associated with this message. I will attempt to delete this submission in 7 seconds.`
			};
		}

		if (request.resolved_by) {
			setTimeout(async () => {
				await interaction.message.delete().catch(() => null);
			}, 7000);

			return {
				error: `This request has already been resolved by ${userMentionWithId(
					request.resolved_by
				)}. I will attempt to delete this submission in 7 seconds.`
			};
		}

		if (action === BanRequestAction.Disregard) {
			return BanRequestUtils.disregard({ interaction, request });
		}

		if (config.enforce_deny_reason || config.enforce_accept_reason) {
			const reasonInput = new TextInputBuilder()
				.setCustomId("reason")
				.setStyle(TextInputStyle.Paragraph)
				.setMaxLength(1024)
				.setMinLength(1)
				.setRequired(true);

			// prettier-ignore
			const reasonLabel = new LabelBuilder()
				.setLabel("Reason")
				.setTextInputComponent(reasonInput);

			const modal = new ModalBuilder()
				.setCustomId(`ban-request-${action}-${request.id}`)
				.setTitle(`${action === BanRequestAction.Deny ? "Deny" : "Accept"} Ban Request`)
				.addLabelComponents(reasonLabel);

			await interaction.showModal(modal);
			return null;
		}

		return BanRequestUtils.process({
			interaction,
			action,
			request,
			reason: "No reason provided."
		});
	}
}
