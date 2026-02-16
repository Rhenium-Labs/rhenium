import { Colors, MessageFlags, messageLink } from "discord.js";
import type { ResponseData } from "#commands/Command.js";

import MessageReportUtils, {
	MessageReportAction,
	REPORT_ACTION_TO_PAST_TENSE
} from "#utils/MessageReports.js";
import Component, { type ComponentExecutionContext } from "#components/Component.js";

export default class MessageReportButton extends Component {
	constructor() {
		super({ matches: /^message-report-(resolve|disregard)$/m });
	}

	async execute({
		interaction,
		config
	}: ComponentExecutionContext<"button">): Promise<ResponseData<"interaction"> | null> {
		if (!config.parseReportsConfig())
			return { error: "Message reports have not been configured on this server." };

		await interaction.deferUpdate();

		const reportAction = interaction.customId
			.split("-")[2]
			.toLowerCase() as MessageReportAction;

		// prettier-ignore
		const result = await MessageReportUtils.handle(
			interaction,
			reportAction,
			config
		);

		if (!result.ok) {
			await interaction
				.followUp({
					embeds: [{ description: result.message, color: Colors.Red }],
					flags: MessageFlags.Ephemeral
				})
				.catch(() => null);

			return null;
		}

		const formattedReportAction = REPORT_ACTION_TO_PAST_TENSE[reportAction].toLowerCase();
		const formattedLogs =
			result.data.logs && result.data.logs.length > 0
				? result.data.logs
						.map(log => messageLink(log.channel_id, log.id, interaction.guildId))
						.join(", ")
				: null;

		await interaction
			.followUp({
				content: `Successfully ${formattedReportAction} report - ID \`${interaction.message.id}\`${formattedLogs ? `\n └ ${formattedLogs}` : ""}`,
				flags: MessageFlags.Ephemeral
			})
			.catch(() => null);

		return null;
	}
}
