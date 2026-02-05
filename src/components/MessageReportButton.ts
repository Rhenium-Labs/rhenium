import { MessageFlags } from "discord.js";
import type { ResponseData } from "#managers/commands/Command.js";

import MessageReportUtils, {
	MessageReportAction,
	MessageReportActionToPastTenseMap
} from "#utils/MessageReports.js";
import Component, { type ComponentExecutionContext } from "#managers/components/Component.js";

export default class MessageReportButton extends Component {
	constructor() {
		super({ matches: /^message-report-(resolve|disregard)$/m });
	}

	async execute({
		interaction,
		config
	}: ComponentExecutionContext<"button">): Promise<ResponseData<"interaction"> | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!config.parseReportsConfig())
			return { error: "Message reports have not been configured on this server." };

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
			return { error: result.message };
		}

		const formattedReportAction =
			MessageReportActionToPastTenseMap[reportAction].toLowerCase();

		return {
			content: `Successfully ${formattedReportAction} report - ID \`${interaction.message.id}\``,
			temporary: true
		};
	}
}
