import {
	type AutocompleteInteraction,
	type CommandInteraction,
	type Interaction,
	type InteractionReplyOptions,
	Colors,
	Events,
	MessageFlags
} from "discord.js";
import { captureException } from "@sentry/node";

import { RedisCache } from "#utils/Redis.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";

import type { ComponentInteraction } from "#classes/Component.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Logger from "#utils/Logger.js";
import Command from "#classes/Command.js";
import Component from "#classes/Component.js";
import EventListener from "#classes/EventListener.js";
import CommandManager from "#managers/CommandManager.js";
import ComponentManager from "#managers/ComponentManager.js";

export default class InteractionCreate extends EventListener {
	public constructor() {
		super(Events.InteractionCreate);
	}

	public async onEmit(interaction: Interaction): Promise<void> {
		if (!interaction.inCachedGuild()) return;

		// Autocomplete isn't supported yet.
		if (interaction.isAutocomplete()) {
			throw new Error("Autocomplete handling not implemented yet.");
		}

		if (!(await InteractionCreate._checkWhitelist(interaction))) return;

		try {
			await InteractionCreate._handle(interaction);
		} catch (error) {
			await InteractionCreate._handleError(interaction, error);
		}
	}

	/**
	 * Handles error reporting and user feedback for failed interactions.
	 */
	private static async _handleError(
		interaction: Exclude<Interaction<"cached">, AutocompleteInteraction>,
		error: unknown
	): Promise<void> {
		const sentryId = captureException(error, {
			user: { id: interaction.user.id, username: interaction.user.username },
			extra: {
				channelId: interaction.channel?.id,
				guildId: interaction.guild.id,
				interactionId: interaction.id
			}
		});

		const errorMessage = `An error occurred while executing this interaction (\`${sentryId}\`).`;

		if (interaction.deferred || interaction.replied) {
			await interaction.followUp({ content: errorMessage });
		} else {
			await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
		}

		Logger.error("Error handling interaction:", error);
	}

	private static async _handle(interaction: Exclude<Interaction<"cached">, AutocompleteInteraction>): Promise<void> {
		const structure = interaction.isCommand()
			? CommandManager.get(interaction.commandName)
			: ComponentManager.get(interaction.customId);

		if (!structure) {
			await interaction.reply({ content: "Unknown interaction.", flags: [MessageFlags.Ephemeral] });
			return Logger.warn(`Unknown interaction: ${interaction.id}`);
		}

		const response = await InteractionCreate._executeHandler(interaction, structure);

		// Reply was handled manually.
		if (!response) return;

		return InteractionCreate._sendResponse(interaction, response);
	}

	/**
	 * Executes the appropriate handler for the given structure.
	 */
	private static async _executeHandler(
		interaction: Exclude<Interaction<"cached">, AutocompleteInteraction>,
		structure: Command | Component
	): Promise<InteractionReplyData | null> {
		if (structure instanceof Command) {
			if (!structure.interactionRun) {
				const sentryId = captureException(new Error("Command missing interactionRun method."), {
					user: { id: interaction.user.id, username: interaction.user.username },
					extra: {
						channelId: interaction.channel?.id,
						guildId: interaction.guild.id,
						interactionId: interaction.id,
						commandName: structure.name
					}
				});

				await interaction.reply({
					content: `An error occurred while executing this interaction (\`${sentryId}\`).`,
					flags: [MessageFlags.Ephemeral]
				});

				Logger.error(`Command ${structure.name} missing interactionRun method.`);
				return null;
			}

			return structure.interactionRun(interaction as CommandInteraction<"cached">);
		}

		return structure.run(interaction as ComponentInteraction);
	}

	/**
	 * Sends the response to the user, handling errors and temporary messages.
	 */
	private static async _sendResponse(
		interaction: Exclude<Interaction<"cached">, AutocompleteInteraction>,
		response: InteractionReplyData
	): Promise<void> {
		const { error, temporary, ...options } = response;

		const defaultFlags = { flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] } } as const;

		const replyOptions: InteractionReplyOptions = error
			? {
					...defaultFlags,
					...options,
					embeds: [{ description: error, color: Colors.Red }, ...(options.embeds ?? [])]
				}
			: { ...defaultFlags, ...options };

		if (interaction.deferred || interaction.replied) {
			const { flags, ...editOptions } = replyOptions;
			await interaction.editReply(editOptions);
		} else {
			await interaction.reply(replyOptions);
		}

		if (error || temporary) {
			setTimeout(() => interaction.deleteReply().catch(() => {}), 7500);
		}
	}

	/**
	 * Checks if the guild is whitelisted to use the bot.
	 */
	private static async _checkWhitelist(
		interaction: Exclude<Interaction<"cached">, AutocompleteInteraction>
	): Promise<boolean> {
		if (DEVELOPER_IDS.includes(interaction.user.id)) return true;

		const isWhitelisted = await RedisCache.guildIsWhitelisted(interaction.guild.id);

		if (!isWhitelisted) {
			await interaction.reply({
				content: "This guild is not whitelisted to use the bot.",
				flags: [MessageFlags.Ephemeral]
			});
		}

		return isWhitelisted;
	}
}
