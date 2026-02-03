import { Result } from "@sapphire/result";
import {
	type Interaction,
	type CommandInteraction,
	type InteractionReplyOptions,
	Colors,
	Events,
	MessageFlags
} from "discord.js";
import { captureException } from "@sentry/node";

import { client } from "#root/index.js";
import { getWhitelistStatus } from "#utils/index.js";
import { ApplyOptions, ComponentInteraction, EventListener } from "#rhenium";

import type { InteractionReplyData } from "#utils/Types.js";

import Logger from "#utils/Logger.js";
import GuildConfig from "#config/GuildConfig.js";
import GlobalConfig from "#config/GlobalConfig.js";
import ConfigManager from "#config/ConfigManager.js";

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

		const whitelisted = await getWhitelistStatus(interaction.guild.id);
		if (!whitelisted && !GlobalConfig.isDeveloper(interaction.user.id)) return;

		const config = await ConfigManager.get(interaction.guild.id);

		try {
			await InteractionCreate._handle(interaction, config);
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

			const content = `An error occurred while executing this interaction. Please use this ID when reporting the bug: \`${sentryId}\`.`;

			if (interaction.deferred || interaction.replied) {
				Result.fromAsync(() => interaction.editReply({ content }));
			} else {
				Result.fromAsync(() =>
					interaction.reply({ content, flags: [MessageFlags.Ephemeral] })
				);
			}

			Logger.tracable(sentryId, error);
			return;
		}
	}

	private static async _handle(
		interaction: CommandInteraction<"cached"> | ComponentInteraction,
		config: GuildConfig
	): Promise<void> {
		let response: InteractionReplyData | null = null;

		if (interaction.isCommand()) {
			response = await InteractionCreate._handleCommand(interaction, config);
		} else {
			response = await InteractionCreate._handleComponent(interaction, config);
		}

		// The reply to the interaction was handled manually.
		if (!response) return;

		const { temporary, error, ...baseOptions } = response;

		const defaultReplyOptions: InteractionReplyOptions = {
			flags: MessageFlags.Ephemeral,
			allowedMentions: { parse: [] }
		};

		const embeds = error
			? [{ description: error, color: Colors.Red }, ...(baseOptions.embeds ?? [])]
			: baseOptions.embeds;

		const options: InteractionReplyOptions = {
			...defaultReplyOptions,
			...baseOptions,
			embeds
		};

		// We wrap the call in Result.fromAsync to prevent "Unknown Interaction" errors.
		if (interaction.deferred || interaction.replied) {
			const { flags, ...editOptions } = options;
			await Result.fromAsync(() => interaction.editReply(editOptions));
		} else {
			await Result.fromAsync(() => interaction.reply(options));
		}

		if (error || temporary) {
			setTimeout(() => {
				Result.fromAsync(() => interaction.deleteReply());
			}, 7500);
		}
	}

	private static async _handleCommand(
		interaction: CommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData | null> {
		// prettier-ignore
		const command = client.stores
			.get('commands')
			.get(interaction.commandName);

		if (!command) throw new Error(`Command '${interaction.commandName}' not found in store.`);

		if (!command.interactionRun)
			throw new Error(
				`Command '${interaction.commandName}' has been registered without an interactionRun method.`
			);

		return command.interactionRun(interaction, config);
	}

	private static async _handleComponent(
		interaction: ComponentInteraction,
		config: GuildConfig
	): Promise<InteractionReplyData | null> {
		// prettier-ignore
		const component = client.stores
			.get('components')
			.get(interaction.customId);

		if (!component)
			throw new Error(`Component '${interaction.customId}' not found in store.`);

		return component.run(interaction, config);
	}
}
