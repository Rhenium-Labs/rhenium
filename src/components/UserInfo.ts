import { Colors, EmbedBuilder, time } from "discord.js";

import { inflect } from "#utils/index.js";
import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^user-info-\d{17,19}$/m }
})
export default class UserInfo extends Component {
	public async run(interaction: Component.Interaction<"button">): Promise<InteractionReplyData> {
		const targetId = interaction.customId.split("-")[2];
		const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);

		if (!targetUser) {
			return { error: "Failed to fetch user information." };
		}

		const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

		const embed = new EmbedBuilder()
			.setColor(Colors.NotQuiteBlack)
			.setAuthor({
				name: `@${targetUser.username}`,
				iconURL: targetUser.displayAvatarURL(),
				url: targetUser.displayAvatarURL()
			})
			.setFields([
				{
					name: "Account Created",
					value: time(targetUser.createdAt, "R"),
					inline: true
				}
			])
			.setFooter({ text: `User ID: ${targetUser.id}` });

		if (targetMember?.joinedAt) {
			embed.addFields([
				{
					name: "Joined Server",
					value: time(targetMember.joinedAt, "R"),
					inline: true
				}
			]);
		}

		if (targetMember?.isCommunicationDisabled()) {
			embed.addFields([
				{
					name: "Timeout Expires",
					value: time(targetMember.communicationDisabledUntil!, "R"),
					inline: true
				}
			]);
		}

		const banned = await interaction.guild.bans.fetch(targetId).catch(() => null);

		if (banned) {
			embed.setColor(Colors.DarkRed);
			embed.addFields([
				{
					name: "Banned",
					value: `${banned.reason ?? "No reason provided"}.`,
					inline: true
				}
			]);
		}

		const [pending, resolved] = await this.prisma.$transaction([
			this.prisma.messageReport.count({
				where: { author_id: targetId, guild_id: interaction.guild.id, status: "Pending" }
			}),
			this.prisma.messageReport.count({
				where: { author_id: targetId, guild_id: interaction.guild.id, NOT: { status: "Pending" } }
			})
		]);

		if ((pending || resolved) > 0) {
			const count = pending + resolved;
			embed.addFields([
				{
					name: "Existing Reports",
					value: `${count} ${inflect(count, "report")} (${pending} pending, ${resolved} resolved).`,
					inline: true
				}
			]);
		}

		return { embeds: [embed] };
	}
}
