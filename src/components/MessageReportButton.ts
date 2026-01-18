import type { ButtonInteraction } from "discord.js";

import { userMentionWithId } from "#utils/index.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Component from "#managers/components/Component.js";
import GuildConfig from "#managers/config/GuildConfig.js";
import MessageReportUtils, { type MessageReportAction } from "#utils/MessageReports.js";

const AUTO_DELETE_DELAY = 7000;

export default class MessageReportButton extends Component {
	public constructor() {
		super({ matches: /^message-report-(resolve|disregard)$/m });
	}

	public async run(
		interaction: ButtonInteraction<"cached">,
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
