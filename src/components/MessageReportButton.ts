import { userMentionWithId } from "#utils/index.js";
import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import MessageReportUtils, { type MessageReportAction } from "#utils/MessageReports.js";

const AUTO_DELETE_DELAY = 7000;

@ApplyOptions<Component.Options>({
	id: { matches: /^message-report-(resolve|disregard)$/m }
})
export default class MessageReportButton extends Component {
	public async run(
		interaction: Component.Interaction<"button">,
		configClass: GuildConfig
	): Promise<InteractionReplyData | null> {
		const config = configClass.getMessageReportsConfig();

		if (!configClass.hasPermission(interaction.member, "ReviewMessageReports")) {
			return { error: "You do not have permission to review message reports." };
		}

		if (!config) {
			return { error: "Message reports are not configured for this server." };
		}

		const action = interaction.customId.split("-")[2] as MessageReportAction;
		const report = await this.prisma.messageReport.findUnique({
			where: { id: interaction.message.id, guild_id: interaction.guild.id }
		});

		if (!report) {
			setTimeout(() => interaction.message?.delete().catch(() => null), AUTO_DELETE_DELAY);
			return {
				error: "Failed to find the message report associated with this message. I will attempt to delete this submission in 7 seconds."
			};
		}

		if (report.resolved_by) {
			setTimeout(() => interaction.message?.delete().catch(() => null), AUTO_DELETE_DELAY);
			return {
				error: `This report has already been resolved by ${userMentionWithId(report.resolved_by)}. I will attempt to delete this submission in 7 seconds.`
			};
		}

		return MessageReportUtils.handle({ interaction, action, report, config });
	}
}
