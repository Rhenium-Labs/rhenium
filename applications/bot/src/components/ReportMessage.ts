import { MessageFlags } from "discord.js";

import { TARGET_MESSAGE_KV } from "@root/commands/ReportMessageCtx";
import type { ResponseData } from "@commands/Command";

import MessageReportUtils from "@utils/MessageReports";
import Component, { type ComponentExecutionContext } from "@components/Component";

export default class ReportMessage extends Component {
	constructor() {
		super({ matches: /^report-message-\d{17,19}-\d{17,19}$/m });
	}

	async execute({
		interaction,
		config
	}: ComponentExecutionContext<"modal">): Promise<ResponseData<"interaction">> {
		if (!config.parseReportsConfig())
			return { error: "Message reports have not been configured on this server." };

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const messageId = interaction.customId.split("-")[3];
		const message = TARGET_MESSAGE_KV.get(messageId);

		if (!message)
			return {
				error: `Failed to get the message with ID ${messageId}.`
			};

		const reportReason = interaction.fields.getTextInputValue("reason");

		if (!reportReason.match(/\w/g))
			return { error: "You must provide a valid reason for reporting this message." };

		const result = await MessageReportUtils.upsert(
			interaction.user,
			message,
			config,
			reportReason
		);

		// Clean up the KV entry to prevent memory leaks.
		// This is safe to do here because the modal can only be submitted once, and the message data is not needed after submission.
		TARGET_MESSAGE_KV.delete(messageId);

		return !result.ok
			? { error: result.message }
			: {
					content: `Successfully reported ${message.author}'s message, thank you for your report!`
				};
	}
}
