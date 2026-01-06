import {
	type ChatInputCommandInteraction,
	type ApplicationCommandData,
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

import type { InteractionReplyData } from "#utils/Types.js";

import Command from "#managers/commands/Command.js";
import GuildConfig from "#managers/config/GuildConfig.js";

export default class QuickActions extends Command {
	public constructor() {
		super({
			name: "quick",
			description: "Manage your quick action reactions."
		});
	}

	public register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			contexts: [InteractionContextType.Guild],
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
			options: [
				{
					name: QuickSubcommandGroup.Mutes,
					description: "Manage your quick mute reactions.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: QuickSubcommand.Add,
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
									description: "The duration for the mute (e.g., 10m, 1h, 1d).",
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
									description: "Number of messages to purge (0 = none, default: 0).",
									type: ApplicationCommandOptionType.Integer,
									required: false,
									min_value: 0,
									max_value: 100
								}
							]
						},
						{
							name: QuickSubcommand.Remove,
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
							name: QuickSubcommand.List,
							description: "List your quick mute reactions.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: QuickSubcommand.Clear,
							description: "Clear all your quick mute reactions.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: QuickSubcommandGroup.Purges,
					description: "Manage your quick purge reactions.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: QuickSubcommand.Add,
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
							name: QuickSubcommand.Remove,
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
							name: QuickSubcommand.List,
							description: "List your quick purge reactions.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: QuickSubcommand.Clear,
							description: "Clear all your quick purge reactions.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				}
			]
		};
	}

	public async interactionRun(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const group = interaction.options.getSubcommandGroup(true) as QuickSubcommandGroup;
		const subcommand = interaction.options.getSubcommand(true) as QuickSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const routeKey = `${group}:${subcommand}`;

		const handlers: Record<string, () => Promise<InteractionReplyData>> = {
			// Mutes group
			[`${QuickSubcommandGroup.Mutes}:${QuickSubcommand.Add}`]: () => this._addMute(interaction, config),
			[`${QuickSubcommandGroup.Mutes}:${QuickSubcommand.Remove}`]: () => this._removeMute(interaction),
			[`${QuickSubcommandGroup.Mutes}:${QuickSubcommand.List}`]: () => this._listMutes(interaction),
			[`${QuickSubcommandGroup.Mutes}:${QuickSubcommand.Clear}`]: () => this._clearMutes(interaction),
			// Purges group
			[`${QuickSubcommandGroup.Purges}:${QuickSubcommand.Add}`]: () => this._addPurge(interaction, config),
			[`${QuickSubcommandGroup.Purges}:${QuickSubcommand.Remove}`]: () => this._removePurge(interaction),
			[`${QuickSubcommandGroup.Purges}:${QuickSubcommand.List}`]: () => this._listPurges(interaction),
			[`${QuickSubcommandGroup.Purges}:${QuickSubcommand.Clear}`]: () => this._clearPurges(interaction)
		};

		const handler = handlers[routeKey];
		return handler ? handler() : { error: "Unknown subcommand." };
	}

	private async _addMute(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const reactionInput = interaction.options.getString("reaction", true);
		const durationInput = interaction.options.getString("duration", true);
		const reason = interaction.options.getString("reason", true);
		const purgeAmount = interaction.options.getInteger("purge_amount") ?? 0;

		const quickMuteCount = await this.prisma.quickMute.count({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId
			}
		});

		if (!config.data.quick_mutes.enabled || !config.data.quick_mutes.webhook_url) {
			return {
				error: "Quick mutes have not been configured on this server."
			};
		}

		// Hardcoded limit of 10 quick mutes per user.
		if (quickMuteCount >= 10) {
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

		const existing = await this.prisma.quickMute.findUnique({
			where: {
				user_id_guild_id_reaction: {
					user_id: interaction.user.id,
					guild_id: interaction.guildId,
					reaction: reactionIdentifier
				}
			}
		});

		if (existing) {
			return {
				error: `You already have a quick mute configured for this reaction. Remove it first to add a new one.`
			};
		}

		await this.prisma.quickMute.create({
			data: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId,
				reaction: reactionIdentifier,
				duration: BigInt(duration),
				reason,
				purge_amount: purgeAmount
			}
		});

		const formattedDuration = ms(duration, { long: true });
		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully added quick mute: ${emojiDisplay} → **${formattedDuration}**${purgeAmount > 0 ? ` + purge ${purgeAmount} messages` : ""}\nReason: \`${reason}\``
		};
	}

	private async _removeMute(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const reactionInput = interaction.options.getString("reaction", true);
		const validatedEmoji = await validateEmoji(reactionInput, interaction.guildId);

		if (!validatedEmoji) {
			return {
				error: "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server."
			};
		}

		const reactionIdentifier = validatedEmoji.id ?? validatedEmoji.name;

		try {
			await this.prisma.quickMute.delete({
				where: {
					user_id_guild_id_reaction: {
						user_id: interaction.user.id,
						guild_id: interaction.guildId,
						reaction: reactionIdentifier
					}
				}
			});
		} catch {
			return {
				error: `You don't have a quick mute configured for this reaction.`
			};
		}

		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully removed quick mute for ${emojiDisplay}.`
		};
	}

	private async _listMutes(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const quickMutes = await this.prisma.quickMute.findMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId
			}
		});

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
			const emojiDisplay = (await getEmojiDisplay(qm.reaction, interaction.guildId)) ?? "unknown";

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

	private async _clearMutes(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const { count } = await this.prisma.quickMute.deleteMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId
			}
		});

		if (count === 0) {
			return {
				content: "You don't have any quick mutes to clear."
			};
		}

		return {
			content: `Successfully cleared \`${count}\` ${inflect(count, "quick mute")}.`
		};
	}

	private async _addPurge(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const reactionInput = interaction.options.getString("reaction", true);
		const purgeAmount = interaction.options.getInteger("amount", true);

		const quickPurgeCount = await this.prisma.quickPurge.count({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId
			}
		});

		if (!config.data.quick_purges.enabled || !config.data.quick_purges.webhook_url) {
			return {
				error: "Quick purges have not been configured on this server."
			};
		}

		// Hardcoded limit of 10 quick purges per user.
		if (quickPurgeCount >= 10) {
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

		const existing = await this.prisma.quickPurge.findUnique({
			where: {
				user_id_guild_id_reaction: {
					user_id: interaction.user.id,
					guild_id: interaction.guildId,
					reaction: reactionIdentifier
				}
			}
		});

		if (existing) {
			return {
				error: `You already have a quick purge configured for this reaction. Remove it first to add a new one.`
			};
		}

		await this.prisma.quickPurge.create({
			data: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId,
				reaction: reactionIdentifier,
				purge_amount: purgeAmount
			}
		});

		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully added quick purge: ${emojiDisplay} → purge **${purgeAmount}** ${inflect(purgeAmount, "message")}`
		};
	}

	private async _removePurge(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const reactionInput = interaction.options.getString("reaction", true);
		const validatedEmoji = await validateEmoji(reactionInput, interaction.guildId);

		if (!validatedEmoji) {
			return {
				error: "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server."
			};
		}

		const reactionIdentifier = validatedEmoji.id ?? validatedEmoji.name;

		try {
			await this.prisma.quickPurge.delete({
				where: {
					user_id_guild_id_reaction: {
						user_id: interaction.user.id,
						guild_id: interaction.guildId,
						reaction: reactionIdentifier
					}
				}
			});
		} catch {
			return {
				error: `You don't have a quick purge configured for this reaction.`
			};
		}

		const emojiDisplay = validatedEmoji.id
			? `<:${validatedEmoji.name}:${validatedEmoji.id}>`
			: validatedEmoji.name;

		return {
			content: `Successfully removed quick purge for ${emojiDisplay}.`
		};
	}

	private async _listPurges(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const quickPurges = await this.prisma.quickPurge.findMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId
			}
		});

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
			const emojiDisplay = (await getEmojiDisplay(qp.reaction, interaction.guildId)) ?? "unknown";

			embed.addFields({
				name: emojiDisplay,
				value: `→ purge **${qp.purge_amount}** ${inflect(qp.purge_amount, "message")}`,
				inline: false
			});
		}

		return { embeds: [embed] };
	}

	private async _clearPurges(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const { count } = await this.prisma.quickPurge.deleteMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guildId
			}
		});

		if (count === 0) {
			return {
				content: "You don't have any quick purges to clear."
			};
		}

		return {
			content: `Successfully cleared \`${count}\` ${inflect(count, "quick purge")}.`
		};
	}
}

const QuickSubcommandGroup = {
	Mutes: "mutes",
	Purges: "purges"
} as const;

type QuickSubcommandGroup = (typeof QuickSubcommandGroup)[keyof typeof QuickSubcommandGroup];

const QuickSubcommand = {
	Add: "add",
	Remove: "remove",
	List: "list",
	Clear: "clear"
} as const;

type QuickSubcommand = (typeof QuickSubcommand)[keyof typeof QuickSubcommand];
