import { MessageFlags } from "discord.js";
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
		if (!config.parseReportsConfig()) {
			return { error: "Message reports have not been configured on this server." };
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const channelId = interaction.customId.split("-")[2];
		const messageId = interaction.customId.split("-")[3];

		const message = await interaction.guild.channels
			.fetch(channelId)
			.then(async channel => {
				return channel?.isTextBased()
					? await channel.messages.fetch(messageId).catch(() => null)
					: null;
			})
			.catch(() => null);

		if (!message) {
			return {
				error: `Failed to fetch the message with ID ${messageId}.`
			};
		}

		const reportReason = interaction.fields.getTextInputValue("reason");

		if (!reportReason.match(/\w/g)) {
			return { error: "You must provide a valid reason for reporting this message." };
		}

		const result = await MessageReportUtils.upsert(
			interaction.user,
			message,
			config,
			reportReason
		);

		if (!result.ok) {
			return { error: result.message };
		}

		return {
			content: `Successfully reported ${message.author}'s message, thank you for your report!`
		};
	}
}
