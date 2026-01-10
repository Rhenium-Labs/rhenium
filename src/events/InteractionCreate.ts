import { type Interaction, Events } from "discord.js";
import { captureException } from "@sentry/node";

import { KvCache } from "#utils/KvCache.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#managers/config/GlobalConfig.js";
import EventListener from "#managers/events/EventListener.js";
import CommandManager from "#managers/commands/CommandManager.js";
import ComponentManager from "#managers/components/ComponentManager.js";

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

		const whitelist = await KvCache.getWhitelistStatus(interaction.guild.id);
		if (!whitelist && !GlobalConfig.isDeveloper(interaction.user.id)) return;

		try {
			if (interaction.isCommand()) {
				await CommandManager.handleApplicationCommand(interaction);
				return;
			}

			if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
				await ComponentManager.handleComponent(interaction);
				return;
			}
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					interactionId: interaction.id,
					interactionIdentifier: interaction.isCommand()
						? interaction.commandName
						: interaction.customId,
					interactionType: interaction.type,
					guildId: interaction.guild.id
				}
			});

			Logger.tracable(sentryId, error);
			return;
		}
	}
}
