import { Colors, EmbedBuilder, time } from "discord.js";

import { kysely } from "@root/index";
import { inflect } from "@utils/index";
import type { ResponseData } from "@commands/Command";

import Component, { type ComponentExecutionContext } from "@components/Component";

export default class UserInfo extends Component {
	constructor() {
		super({ matches: /^user-info-\d{17,19}$/m });
	}

	async execute({
		interaction
	}: ComponentExecutionContext<"button">): Promise<ResponseData<"interaction">> {
		const targetUserId = interaction.customId.split("-")[2];

		// Fetch user, member, and ban status in parallel.
		const [targetUser, targetMember, isBanned] = await Promise.all([
			interaction.client.users.fetch(targetUserId).catch(() => null),
			interaction.guild.members.fetch(targetUserId).catch(() => null),
			interaction.guild.bans.fetch(targetUserId).catch(() => null)
		]);

		if (!targetUser) return { error: "Failed to fetch user information." };

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

		if (targetMember?.joinedAt)
			embed.addFields([
				{
					name: "Joined Server",
					value: time(targetMember.joinedAt, "R"),
					inline: true
				}
			]);

		if (targetMember?.isCommunicationDisabled())
			embed.addFields([
				{
					name: "Timeout Expires",
					value: time(targetMember.communicationDisabledUntil!, "R"),
					inline: true
				}
			]);

		if (isBanned) {
			embed.setColor(Colors.DarkRed);
			embed.addFields([
				{
					name: "Banned",
					value: `${isBanned.reason ?? "No reason provided"}.`,
					inline: true
				}
			]);
		}

		const [pending, resolved] = await kysely.transaction().execute(async trx =>
			Promise.all([
				trx
					.selectFrom("MessageReport")
					.select(eb => eb.fn.countAll<number>().as("count"))
					.where("author_id", "=", targetUserId)
					.where("guild_id", "=", interaction.guild.id)
					.where("status", "=", "Pending")
					.executeTakeFirstOrThrow()
					.then(r => Number(r.count)),
				trx
					.selectFrom("MessageReport")
					.select(eb => eb.fn.countAll<number>().as("count"))
					.where("author_id", "=", targetUserId)
					.where("guild_id", "=", interaction.guild.id)
					.where("status", "!=", "Pending")
					.executeTakeFirstOrThrow()
					.then(r => Number(r.count))
			])
		);

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
