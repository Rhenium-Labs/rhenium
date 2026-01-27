import {
	ApplicationCommandType,
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags
} from "discord.js";

import { ReportStatus } from "#prisma/enums.js";
import { ApplyOptions, Command } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import MessageReportUtils from "#utils/MessageReports.js";

@ApplyOptions<Command.Options>({
	name: "Report Message",
	description: "Report a message to the server moderators."
})
export default class ReportMessageCtx extends Command {
	public register(): Command.Data {
		return {
			name: this.name,
			type: ApplicationCommandType.Message
		};
	}

	public async interactionRun(
		interaction: Command.Interaction<"messageContextMenu">,
		configClass: GuildConfig
	): Promise<InteractionReplyData | null> {
		const config = configClass.getMessageReportsConfig();

		if (!config?.enforce_report_reason) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}

		if (!config) {
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

		if (message.author.bot || message.webhookId || message.system) {
			return {
				error: "You cannot report bot, webhook, or system messages."
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
				status: ReportStatus.Pending
			}
		});

		if (report) {
			if (report.reported_by === interaction.user.id) {
				return {
					error: "You have already reported this message."
				};
			}

			void MessageReportUtils.bumpSubmission({
				interaction,
				config,
				report
			});

			return {
				content: `Successfully bumped report submission for ${targetUser}'s message - ID \`#${report.id}\``
			};
		}

		if (!config.enforce_report_reason) {
			return MessageReportUtils.create({
				author: message.author,
				interaction,
				config,
				message,
				reason: config.placeholder_reason ?? "No reason provided."
			});
		}

		const reasonInput = new TextInputBuilder()
			.setCustomId("report-reason")
			.setStyle(TextInputStyle.Paragraph)
			.setMaxLength(1024)
			.setMinLength(1)
			.setRequired(true);

		if (config.placeholder_reason) {
			reasonInput.setValue(config.placeholder_reason);
		}

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
