import { type ButtonInteraction, Colors, EmbedBuilder, time } from "discord.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Component from "#managers/components/Component.js";
import { inflect } from "#utils/index.js";

export default class UserInfo extends Component {
	public constructor() {
		super({ matches: /^user-info-\d{17,19}$/m });
	}

	public async run(interaction: ButtonInteraction<"cached">): Promise<InteractionReplyData> {
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

		const reports = await this.prisma.messageReport.findMany({
			where: {
				author_id: targetId,
				guild_id: interaction.guild.id
			}
		});

		if (reports.length > 0) {
			const [pending, resolved] = reports.reduce(
				(acc, report) => {
					if (report.resolved_by) {
						acc[1]++;
					} else {
						acc[0]++;
					}
					return acc;
				},
				[0, 0]
			);

			embed.addFields([
				{
					name: "Existing Reports",
					value: `${reports.length} ${inflect(reports.length, "report", "reports")} (${pending} pending, ${resolved} resolved).`,
					inline: true
				}
			]);
		}

		return { embeds: [embed] };
	}
}
