import { MessageFlags, type Message, type TextBasedChannel } from "discord.js";

import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import ReportMessageCtx from "#root/commands/ReportMessageCtx.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^report-message-\d{17,19}-\d{17,19}$/m }
})
export default class ReportMessage extends Component {
	public async run(
		interaction: Component.Interaction<"modalSubmit">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.getMessageReportsConfig();

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!config) {
			return { error: "Message reports have not been configured on this server." };
		}

		const channelId = interaction.customId.split("-")[2];
		const messageId = interaction.customId.split("-")[3];

		const channel = (await interaction.guild.channels
			.fetch(channelId)
			.catch(() => null)) as TextBasedChannel | null;

		if (!channel) {
			return { error: `Failed to fetch the channel for message with ID ${messageId}.` };
		}

		const message = (await channel.messages.fetch(messageId).catch(() => null)) as Message<true> | null;

		if (!message) {
			return { error: `Failed to fetch the message with ID ${messageId}. It may have been deleted.` };
		}

		const targetMember = await interaction.guild.members.fetch(message.author.id).catch(() => null);

		if (!targetMember && config.enforce_member_in_guild) {
			return { error: "You can only report messages whose authors are still in the server." };
		}

		if (targetMember?.roles.cache.some(role => config.immune_roles.includes(role.id))) {
			return { error: "You cannot report this message." };
		}

		const reason = interaction.fields.getTextInputValue("report-reason");

		if (!reason.match(/\w/g)) {
			return { error: "You must provide a valid reason for reporting this message." };
		}

		return ReportMessageCtx.createReport({
			author: message.author,
			interaction,
			config,
			message,
			reason
		});
	}
}
