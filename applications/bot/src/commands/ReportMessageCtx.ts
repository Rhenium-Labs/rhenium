import {
	type ApplicationCommandData,
	ApplicationCommandType,
	LabelBuilder,
	Message,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle
} from "discord.js";
import { startCronJob } from "#utils/index.js";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "#commands/Command.js";

import MessageReportUtils from "#utils/MessageReports.js";

/**
 * KV for storing target messages for reports.
 * This is used for passing message data from the context menu command to the modal submission handler without needing to re-fetch the message.
 */
export const TARGET_MESSAGE_KV: Map<string, Message<true>> = new Map();

export default class ReportMessageCtx extends Command {
	constructor() {
		super({
			name: "Report Message",
			category: CommandCategory.Utility,
			description: "Report a message to the server moderators."
		});
	}

	override register(): ApplicationCommandData {
		return {
			name: this.name,
			type: ApplicationCommandType.Message
		};
	}

	override async executeInteraction({
		interaction,
		config
	}: CommandExecutionContext<"messageCtxMenu">): Promise<ResponseData<"interaction"> | null> {
		if (!config.parseReportsConfig()) {
			return {
				error: "Message reports have not been configured on this server."
			};
		}

		if (interaction.user.id === interaction.targetMessage.author.id) {
			return {
				error: "You cannot report your own message."
			};
		}

		const message = interaction.targetMessage;

		if (config.data.message_reports.enforce_report_reason) {
			const reasonTextInputBuilder = new TextInputBuilder()
				.setCustomId("reason")
				.setStyle(TextInputStyle.Paragraph)
				.setMaxLength(1024)
				.setMinLength(1)
				.setRequired(true);

			if (config.data.message_reports.placeholder_reason) {
				reasonTextInputBuilder.setValue(config.data.message_reports.placeholder_reason);
			}

			// prettier-ignore
			const reasonLabel = new LabelBuilder()
				.setLabel("Reason")
				.setTextInputComponent(reasonTextInputBuilder);

			const modal = new ModalBuilder()
				.setCustomId(`report-message-${message.channelId}-${message.id}`)
				.setTitle(`Report @${message.author.username}'s Message`)
				.addLabelComponents(reasonLabel);

			TARGET_MESSAGE_KV.set(message.id, message);

			await interaction.showModal(modal);
			return null;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const reason = config.data.message_reports.placeholder_reason;

		// prettier-ignore
		const result = await MessageReportUtils.upsert(
			interaction.user,
			message,
			config,
			reason
		);

		if (!result.ok) {
			return { error: result.message };
		}

		return {
			content: `Successfully reported ${message.author}'s message, thank you for your report!`
		};
	}

	/** Starts a cron job that periodically cleans up the TARGET_MESSAGE_KV to prevent memory leaks. */
	public static startKVCleanupJob(): void {
		return startCronJob({
			monitorSlug: "REPORT_MESSAGE_KV_CLEANUP",
			cronTime: "0 * * * *", // Every hour.
			onTick: () => {
				TARGET_MESSAGE_KV.clear();
			}
		});
	}
}
