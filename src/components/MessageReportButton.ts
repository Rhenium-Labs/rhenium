import { Colors, MessageFlags } from "discord.js";
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

		await interaction
			.followUp({
				content: `Successfully ${formattedReportAction} report - ID \`${interaction.message.id}\``,
				flags: MessageFlags.Ephemeral
			})
			.catch(() => null);

		return null;
	}
}
