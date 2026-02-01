import { MessageFlags } from "discord.js";
import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import MessageReportUtils, {
	MessageReportAction,
	MessageReportActionToPastTenseMap
} from "#utils/MessageReports.js";
import GuildConfig from "#root/lib/config/GuildConfig.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^message-report-(resolve|disregard)$/m }
})
export default class MessageReportButton extends Component {
	public async run(
		interaction: Component.Interaction<"button">,
		config: GuildConfig
	): Promise<InteractionReplyData | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!config.getMessageReportsConfig())
			return { error: "Message reports have not been configured on this server." };

		const reportAction = interaction.customId
			.split("-")[2]
			.toLowerCase() as MessageReportAction;

		// prettier-ignore
		const result = await MessageReportUtils.handle(
			interaction,
			reportAction,
			config,
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
