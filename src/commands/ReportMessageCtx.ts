import {
	type MessageContextMenuCommandInteraction,
	type ApplicationCommandData,
	ApplicationCommandType,
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle
} from "discord.js";

import { ReportStatus } from "#prisma/enums.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Command from "#classes/Command.js";

export default class ReportMessageCtx extends Command {
	public constructor() {
		super({
			name: "Report Message",
			description: "Report a message to the server moderators."
		});
	}

	public register(): ApplicationCommandData {
		return {
			name: this.name,
			type: ApplicationCommandType.Message
		};
	}

	public async interactionRun(
		interaction: MessageContextMenuCommandInteraction<"cached">
	): Promise<InteractionReplyData | null> {
		const config = await this.prisma.messageReportConfig.findUnique({
			where: { id: interaction.guild.id }
		});

		if (!config?.enabled || !config.webhook_url) {
			return {
				error: "Message reports have not been configured on this server."
			};
		}

		if (config.blacklisted_users.includes(interaction.user.id)) {
			return {
				error: "You are blacklisted from reporting messages on this server."
			};
		}

		const message = interaction.targetMessage;
		const targetUser = interaction.targetMessage.author;
		const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

		if (message.author.bot || message.webhookId) {
			return {
				error: "You cannot report messages sent by bots or webhooks."
			};
		}

		if (!targetUser) {
			return {
				error: "The target message's author could not be found."
			};
		}

		if (targetUser.id === interaction.user.id) {
			return {
				error: "You cannot report your own messages."
			};
		}

		if (targetUser.id === interaction.guild.ownerId) {
			return {
				error: "You cannot report messages sent by the server owner."
			};
		}

		if (!targetMember && config.enforce_member_in_guild) {
			return {
				error: "You can only report messages whose authors are still in the server."
			};
		}

		if (targetMember) {
			if (targetMember.roles.cache.some(role => config.immune_roles.includes(role.id))) {
				return {
					error: "You cannot report this message."
				};
			}
		}

		const report = await this.prisma.messageReport.findFirst({
			where: {
				guild_id: interaction.guild.id,
				message_id: message.id,
				reported_by: interaction.user.id,
				status: ReportStatus.Pending
			}
		});

		if (report) {
			return {
				error: "You have already reported this message and it is still pending review."
			};
		}

		const reasonInput = new TextInputBuilder()
			.setCustomId("report-reason")
			.setStyle(TextInputStyle.Paragraph)
			.setMaxLength(1024)
			.setMinLength(1)
			.setRequired(true);

		// prettier-ignore
		const reasonLabel = new LabelBuilder()
		    .setLabel("Reason")
		    .setTextInputComponent(reasonInput);

		const modal = new ModalBuilder()
			.setCustomId(`report-message-${message.channel.id}-${message.id}`)
			.setTitle(`Report @${targetUser.username}'s Message`)
			.addLabelComponents(reasonLabel);

		await interaction.showModal(modal);
		return null;
	}
}
