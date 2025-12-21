import {
	AutocompleteInteraction,
	Colors,
	CommandInteraction,
	Events,
	Interaction,
	InteractionReplyOptions,
	MessageFlags
} from "discord.js";
import { captureException } from "@sentry/node";

import Logger from "#utils/Logger.js";

import { EventListener } from "#classes/EventListener.js";
import { InteractionReplyData } from "#utils/Types.js";
import { Command, CommandManager } from "#classes/Command.js";
import { ComponentInteraction, ComponentManager } from "#classes/Component.js";

export default class InteractionCreate extends EventListener {
	public constructor() {
		super(Events.InteractionCreate);
	}

	public async onEmit(interaction: Interaction) {
		if (!interaction.inCachedGuild()) return;

		if (interaction.isAutocomplete()) {
			throw new Error("Autocomplete handling not implemented yet.");
		}

		try {
			await InteractionCreate._handle(interaction);
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					channelId: interaction.channel?.id,
					guildId: interaction.guild.id,
					interactionId: interaction.id
				}
			});

			if (interaction.deferred || interaction.replied) {
				await interaction.followUp({
					content: `An error occurred while executing this interaction (\`${sentryId}\`).`
				});
			} else {
				await interaction.reply({
					content: `An error occurred while executing this interaction (\`${sentryId}\`).`,
					ephemeral: true
				});
			}

			return Logger.error("Error handling interaction:", error);
		}
	}

	private static async _handle(interaction: Exclude<Interaction<"cached">, AutocompleteInteraction>) {
		const structure = interaction.isCommand()
			? CommandManager.get(interaction.commandName)
			: ComponentManager.get(interaction.customId);

		if (!structure) {
			await interaction.reply({
				content: "Unknown interaction.",
				ephemeral: true
			});

			return Logger.warn(`Unknown interaction: ${interaction.id}`);
		}

		let response: InteractionReplyData | null;

		if (structure instanceof Command) {
			if (!structure.interactionRun) {
				const sentryId = captureException(new Error("Command missing interactionRun method."), {
					user: {
						id: interaction.user.id,
						username: interaction.user.username
					},
					extra: {
						channelId: interaction.channel?.id,
						guildId: interaction.guild.id,
						interactionId: interaction.id,
						commandName: structure.name
					}
				});

				await interaction.reply({
					content: `An error occurred while executing this interaction (\`${sentryId}\`).`,
					ephemeral: true
				});

				return Logger.error(`Command ${structure.name} missing interactionRun method.`);
			} else {
				response = await structure.interactionRun(interaction as CommandInteraction<"cached">);
			}
		} else {
			response = await structure.run(interaction as ComponentInteraction);
		}

		// Manually handled response.
		if (!response) return;

		const error = response.error;
		delete response.error;

		const defaultOptions: InteractionReplyOptions = {
			flags: [MessageFlags.Ephemeral],
			allowedMentions: { parse: [] }
		};

		const replyOptions = error
			? {
					...defaultOptions,
					...response,
					embeds: [{ description: error, color: Colors.Red }, ...(response.embeds ?? [])]
				}
			: {
					...defaultOptions,
					...response
				};

		if (interaction.deferred || interaction.replied) {
			const { flags, ...options } = replyOptions;
			await interaction.editReply(options);
		} else {
			await interaction.reply(replyOptions);
		}
	}
}
