import { type Interaction, Events } from "discord.js";
import { captureException } from "@sentry/node";

import { KvCache } from "#utils/KvCache.js";
import { ApplyOptions, EventListener } from "#rhenium";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#config/GlobalConfig.js";

@ApplyOptions<EventListener.Options>({
	event: Events.InteractionCreate
})
export default class InteractionCreate extends EventListener {
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
				await this.client.stores.get("commands").handleApplicationCommand(interaction);
				return;
			}

			if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
				await this.client.stores.get("components").handleComponent(interaction);
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
