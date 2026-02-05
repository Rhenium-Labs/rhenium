import {
	type ApplicationCommandData,
	type ChatInputCommandInteraction,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	Colors,
	EmbedBuilder,
	escapeCodeBlock,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits
} from "discord.js";

import ms from "ms";

import {
	getEmojiDisplay,
	inflect,
	parseDurationString,
	truncate,
	validateDuration,
	validateEmoji
} from "#utils/index.js";

import { kysely } from "#root/index.js";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "#managers/commands/Command.js";

import GuildConfig from "#config/GuildConfig.js";

export default class QuickActions extends Command {
	constructor() {
		super({
			name: "quick",
			category: CommandCategory.Moderation,
			description: "Manage your quick action reactions."
		});
	}

	override register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			contexts: [InteractionContextType.Guild],
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
			options: [
				{
					name: QuickActionSubcommandGroup.Mutes,
					description: "Manage your quick mute reactions.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: QuickActionSubcommand.Add,
							description: "Add a quick mute reaction.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "reaction",
									description: "The emoji to use as a reaction trigger.",
									type: ApplicationCommandOptionType.String,
									required: true
								},
								{
									name: "duration",
									description:
										"The duration for the mute (e.g., 10m, 1h, 1d).",
									type: ApplicationCommandOptionType.String,
									required: true
								},
								{
									name: "reason",
									description: "The reason for the mute.",
									type: ApplicationCommandOptionType.String,
									required: true,
									max_length: 1024
								},
								{
									name: "purge_amount",
									description:
										"Number of messages to purge (0 = none, default: 0).",
									type: ApplicationCommandOptionType.Integer,
									required: false,
									min_value: 0,
									max_value: 100
								}
							]
						},
						{
							name: QuickActionSubcommand.Remove,
							description: "Remove a quick mute reaction.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "reaction",
									description: "The emoji reaction to remove.",
									type: ApplicationCommandOptionType.String,
									required: true
								}
							]
						},
						{
							name: QuickActionSubcommand.List,
							description: "List your quick mute reactions.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: QuickActionSubcommand.Clear,
							description: "Clear all your quick mute reactions.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: QuickActionSubcommandGroup.Purges,
					description: "Manage your quick purge reactions.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: QuickActionSubcommand.Add,
							description: "Add a quick purge reaction.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "reaction",
									description: "The emoji to use as a reaction trigger.",
									type: ApplicationCommandOptionType.String,
									required: true
								},
								{
									name: "amount",
									description: "Number of messages to purge.",
									type: ApplicationCommandOptionType.Integer,
									required: true,
									min_value: 1,
									max_value: 100
								}
							]
						},
						{
							name: QuickActionSubcommand.Remove,
							description: "Remove a quick purge reaction.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "reaction",
									description: "The emoji reaction to remove.",
									type: ApplicationCommandOptionType.String,
									required: true
								}
							]
						},
						{
							name: QuickActionSubcommand.List,
							description: "List your quick purge reactions.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: QuickActionSubcommand.Clear,
							description: "Clear all your quick purge reactions.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				}
			]
		};
	}

	override async executeInteraction({
		interaction,
		config
	}: CommandExecutionContext<"chatInputCmd">): Promise<ResponseData<"interaction">> {
		const group = interaction.options.getSubcommandGroup(true) as QuickActionSubcommandGroup;
		const subcommand = interaction.options.getSubcommand(true) as QuickActionSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (group === QuickActionSubcommandGroup.Mutes) {
			switch (subcommand) {
				case QuickActionSubcommand.Add:
					return QuickActions._addQuickMute(interaction, config);
				case QuickActionSubcommand.Remove:
					return QuickActions._removeQuickMute(interaction);
				case QuickActionSubcommand.List:
					return QuickActions._listQuickMutes(interaction);
				case QuickActionSubcommand.Clear:
					return QuickActions._clearQuickMutes(interaction);
			}
		}

		if (group === QuickActionSubcommandGroup.Purges) {
			switch (subcommand) {
				case QuickActionSubcommand.Add:
					return QuickActions._addQuickPurge(interaction, config);
				case QuickActionSubcommand.Remove:
					return QuickActions._removeQuickPurge(interaction);
				case QuickActionSubcommand.List:
					return QuickActions._listQuickPurges(interaction);
				case QuickActionSubcommand.Clear:
					return QuickActions._clearQuickPurges(interaction);
			}
		}

		return { error: "Unknown subcommand." };
	}

	private static async _addQuickMute(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const reactionInput = interaction.options.getString("reaction", true);
		const durationInput = interaction.options.getString("duration", true);
		const reason = interaction.options.getString("reason", true);
		const purgeAmount = interaction.options.getInteger("purge_amount") ?? 0;

		const muteConfig = config.parseQuickActionConfig("quick_mutes");

		if (!muteConfig) {
			return {
				error: "Quick mutes have not been configured on this server."
			};
		}

		const quickMutes = await kysely
			.selectFrom("QuickMute")
			.select(eb => eb.fn.countAll().as("count"))
			.where("guild_id", "=", interaction.guildId)
			.executeTakeFirst();

		// Hardcoded limit of 10 quick mutes per user.
		if (quickMutes?.count !== undefined && Number(quickMutes.count) >= 10) {
			return {
				error: "You have reached the maximum of 10 quick mutes. Please remove an existing one before adding a new one."
			};
		}

		const validatedEmoji = await validateEmoji(reactionInput, interaction.guildId);

		if (!validatedEmoji) {
			return {
				error: "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server."
			};
		}

		const reactionIdentifier = validatedEmoji.id ?? validatedEmoji.name;
		const existing = await kysely
			.selectFrom("QuickMute")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.where("reaction", "=", reactionIdentifier)
			.executeTakeFirst();

		if (existing) {
			return {
				error: `You already have a quick mute configured for this reaction. Remove it first to add a new one.`
			};
		}

		const duration = parseDurationString(durationInput);

		if (!duration) {
			return {
				error: "Invalid duration format. Please use formats like `10m`, `1h`, `1d`."
			};
		}

		const durationValidation = validateDuration({
			duration,
			minimum: "5s",
			maximum: "28d"
		});

		if (!durationValidation.ok) {
			return { error: durationValidation.message };
		}

		if (purgeAmount > config.data.quick_purges.max_limit) {
			return {
				error: `The maximum purge amount for this server is \`${config.data.quick_purges.max_limit}\` messages.`
			};
		}

		await kysely
			.insertInto("QuickMute")
			.values({
				user_id: interaction.user.id,
				guild_id: interaction.guildId,
				reaction: reactionIdentifier,
				duration: BigInt(duration),
				reason,
				purge_amount: purgeAmount
			})
			.execute();

		const formattedDuration = ms(duration, { long: true });
		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully added quick mute: ${emojiDisplay} → **${formattedDuration}**${purgeAmount > 0 ? ` + purge ${purgeAmount} messages` : ""}\nReason: \`${reason}\``
		};
	}

	private static async _removeQuickMute(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<ResponseData<"interaction">> {
		const reactionInput = interaction.options.getString("reaction", true);
		const validatedEmoji = await validateEmoji(reactionInput, interaction.guildId);

		if (!validatedEmoji) {
			return {
				error: "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server."
			};
		}

		const reactionIdentifier = validatedEmoji.id ?? validatedEmoji.name;
		const exists = await kysely
			.selectFrom("QuickMute")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.where("reaction", "=", reactionIdentifier)
			.executeTakeFirst();

		if (!exists) {
			return {
				error: `You don't have a quick mute configured for this reaction.`
			};
		}

		await kysely
			.deleteFrom("QuickMute")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.where("reaction", "=", reactionIdentifier)
			.execute();

		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully removed quick mute for ${emojiDisplay}.`
		};
	}

	private static async _listQuickMutes(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<ResponseData<"interaction">> {
		const quickMutes = await kysely
			.selectFrom("QuickMute")
			.selectAll()
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.execute();

		if (quickMutes.length === 0) {
			return {
				content: "You don't have any quick mutes configured."
			};
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.NotQuiteBlack)
			.setAuthor({
				name: `Quick Mute Configs for @${interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		for (const qm of quickMutes) {
			const emojiDisplay =
				(await getEmojiDisplay(qm.reaction, interaction.guildId)) ?? "unknown";

			const formattedDuration = ms(Number(qm.duration), { long: true });
			const purgeInfo = qm.purge_amount > 0 ? ` + purge ${qm.purge_amount}` : "";

			embed.addFields({
				name: emojiDisplay,
				value: `→ **${formattedDuration}**${purgeInfo}\n└ \`${truncate(escapeCodeBlock(qm.reason), 256)}\``,
				inline: false
			});
		}

		return { embeds: [embed] };
	}

	private static async _clearQuickMutes(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<ResponseData<"interaction">> {
		const { numDeletedRows } = await kysely
			.deleteFrom("QuickMute")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.executeTakeFirst();

		if (numDeletedRows === 0n) {
			return {
				content: "You don't have any quick mutes to clear."
			};
		}

		return {
			content: `Successfully cleared \`${numDeletedRows}\` ${inflect(Number(numDeletedRows), "quick mute")}.`
		};
	}

	private static async _addQuickPurge(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const reactionInput = interaction.options.getString("reaction", true);
		const purgeAmount = interaction.options.getInteger("amount", true);
		const purgeConfig = config.parseQuickActionConfig("quick_purges");

		if (!purgeConfig) {
			return {
				error: "Quick purges have not been configured on this server."
			};
		}

		const quickPurges = await kysely
			.selectFrom("QuickPurge")
			.select(eb => eb.fn.countAll().as("count"))
			.where("guild_id", "=", interaction.guildId)
			.executeTakeFirst();

		// Hardcoded limit of 10 quick purges per user.
		if (quickPurges?.count !== undefined && Number(quickPurges.count) >= 10) {
			return {
				error: "You have reached the maximum of 10 quick purges. Please remove an existing one before adding a new one."
			};
		}

		const validatedEmoji = await validateEmoji(reactionInput, interaction.guildId);

		if (!validatedEmoji) {
			return {
				error: "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server."
			};
		}

		const reactionIdentifier = validatedEmoji.id ?? validatedEmoji.name;
		const existing = await kysely
			.selectFrom("QuickPurge")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.where("reaction", "=", reactionIdentifier)
			.executeTakeFirst();

		if (existing) {
			return {
				error: `You already have a quick purge configured for this reaction. Remove it first to add a new one.`
			};
		}

		if (purgeAmount > purgeConfig.max_limit) {
			return {
				error: `The maximum purge amount for this server is \`${purgeConfig.max_limit}\` messages.`
			};
		}

		await kysely
			.insertInto("QuickPurge")
			.values({
				user_id: interaction.user.id,
				guild_id: interaction.guildId,
				reaction: reactionIdentifier,
				purge_amount: purgeAmount
			})
			.execute();

		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully added quick purge: ${emojiDisplay} → purge **${purgeAmount}** ${inflect(purgeAmount, "message")}`
		};
	}

	private static async _removeQuickPurge(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<ResponseData<"interaction">> {
		const reactionInput = interaction.options.getString("reaction", true);
		const validatedEmoji = await validateEmoji(reactionInput, interaction.guildId);

		if (!validatedEmoji) {
			return {
				error: "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server."
			};
		}

		const reactionIdentifier = validatedEmoji.id ?? validatedEmoji.name;

		const exists = await kysely
			.selectFrom("QuickPurge")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.where("reaction", "=", reactionIdentifier)
			.executeTakeFirst();

		if (!exists) {
			return {
				error: `You don't have a quick purge configured for this reaction.`
			};
		}

		await kysely
			.deleteFrom("QuickPurge")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.where("reaction", "=", reactionIdentifier)
			.execute();

		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully removed quick purge for ${emojiDisplay}.`
		};
	}

	private static async _listQuickPurges(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<ResponseData<"interaction">> {
		const quickPurges = await kysely
			.selectFrom("QuickPurge")
			.selectAll()
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.execute();

		if (quickPurges.length === 0) {
			return {
				content: "You don't have any quick purges configured."
			};
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.NotQuiteBlack)
			.setAuthor({
				name: `Quick Purge Configs for @${interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		for (const qp of quickPurges) {
			const emojiDisplay =
				(await getEmojiDisplay(qp.reaction, interaction.guildId)) ?? "unknown";

			embed.addFields({
				name: emojiDisplay,
				value: `→ purge **${qp.purge_amount}** ${inflect(qp.purge_amount, "message")}`,
				inline: false
			});
		}

		return { embeds: [embed] };
	}

	private static async _clearQuickPurges(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<ResponseData<"interaction">> {
		const { numDeletedRows } = await kysely
			.deleteFrom("QuickPurge")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guildId)
			.executeTakeFirst();

		if (numDeletedRows === 0n) {
			return {
				content: "You don't have any quick purges to clear."
			};
		}

		return {
			content: `Successfully cleared \`${numDeletedRows}\` ${inflect(Number(numDeletedRows), "quick purge")}.`
		};
	}
}

enum QuickActionSubcommandGroup {
	Mutes = "mutes",
	Purges = "purges"
}

enum QuickActionSubcommand {
	Add = "add",
	Remove = "remove",
	List = "list",
	Clear = "clear"
}
