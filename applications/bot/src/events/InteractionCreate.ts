import { Result } from "@sapphire/result";
import {
	type Interaction,
	type CommandInteraction,
	type InteractionReplyOptions,
	Colors,
	Events,
	MessageFlags,
	AutocompleteInteraction
} from "discord.js";
import { captureException, metrics } from "@sentry/node";

import { getWhitelistStatus } from "@utils/index";
import { SENTRY_METRICS_COUNTERS } from "@utils/Constants";

import type { ResponseData } from "@commands/Command";
import type { ComponentInteraction } from "@components/Component";

import Logger from "@utils/Logger";
import GuildConfig from "@config/GuildConfig";
import GlobalConfig from "@config/GlobalConfig";
import EventListener from "@events/EventListener";
import ConfigManager from "@config/ConfigManager";
import CommandManager from "@commands/CommandManager";
import ComponentManager from "@components/ComponentManager";

export default class InteractionCreate extends EventListener {
	constructor() {
		super(Events.InteractionCreate);
	}

	async execute(interaction: Interaction): Promise<void> {
		if (!interaction.inCachedGuild()) return;

		// Autocomplete isn't supported yet.
		if (interaction.isAutocomplete()) {
			return InteractionCreate._handleAutocomplete(interaction);
		}

		const whitelisted = await getWhitelistStatus(interaction.guild.id);
		if (!whitelisted && !GlobalConfig.isDeveloper(interaction.user.id)) return;

		const config = await ConfigManager.getGuildConfig(interaction.guild.id);
		const result = await Result.fromAsync(() =>
			InteractionCreate._handle(interaction, config)
		);

		if (result.isErr()) {
			const error = result.unwrapErr();
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

			const counter = interaction.isCommand()
				? SENTRY_METRICS_COUNTERS.CommandFailed
				: SENTRY_METRICS_COUNTERS.ComponentFailed;

			metrics.count(counter, 1, {
				attributes: {
					guild_id: interaction.guild.id,
					interaction_type: interaction.type,
					interaction_identifier: interaction.isCommand()
						? interaction.commandName
						: interaction.customId
				}
			});

			const content = `An error occurred while executing this interaction. Please use this ID when reporting the bug: \`${sentryId}\`.`;

			// We wrap the calls in `Result.fromAsync` to avoid Unknown Interaction errors.
			if (interaction.deferred || interaction.replied) {
				Result.fromAsync(() => interaction.editReply({ content }));
			} else {
				Result.fromAsync(() =>
					interaction.reply({ content, flags: [MessageFlags.Ephemeral] })
				);
			}

			Logger.traceable(sentryId, `Error occurred while handling an interaction:`, error);
			return;
		}

		const counter = interaction.isCommand()
			? SENTRY_METRICS_COUNTERS.CommandExecuted
			: SENTRY_METRICS_COUNTERS.ComponentExecuted;

		return metrics.count(counter, 1, {
			attributes: {
				guild_id: interaction.guild.id,
				interaction_type: interaction.type,
				interaction_identifier: interaction.isCommand()
					? interaction.commandName
					: interaction.customId
			}
		});
	}

	private static async _handleAutocomplete(interaction: AutocompleteInteraction<"cached">) {
		const option = interaction.options.getFocused(true);
		const value = option.value;
		const lowercaseValue = option.value.toString();

		switch (option.name) {
			case "role": {
				const roles = interaction.guild.roles.cache
					.map(role => ({
						name: `@${role.name}`,
						value: role.id
					}))
					.filter(role => role.value !== interaction.guild.id);

				if (!value) {
					const sortedRoles = roles.sort((a, b) => a.name.localeCompare(b.name));
					return interaction.respond([
						...sortedRoles,
						{ name: "@here", value: "here" }
					]);
				}

				const filteredRoles = roles.filter(role =>
					role.name.toLowerCase().includes(lowercaseValue)
				);

				const sortedRoles = filteredRoles.sort((a, b) => a.name.localeCompare(b.name));
				return interaction.respond([...sortedRoles, { name: "@here", value: "here" }]);
			}
		}
	}

	/**
	 * Handles an interaction by determining its type and executing the appropriate command or component logic.
	 *
	 * @param interaction The interaction to handle, which can be either a CommandInteraction or a ComponentInteraction.
	 * @param config The guild configuration.
	 * @returns A promise that resolves when the interaction is handled.
	 */

	private static async _handle(
		interaction: CommandInteraction<"cached"> | ComponentInteraction,
		config: GuildConfig
	): Promise<void> {
		let response: ResponseData<"interaction"> | null = null;

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

	/**
	 * Handles a command interaction by executing the corresponding command logic.
	 *
	 * @param interaction The CommandInteraction to handle.
	 * @param config The guild configuration.
	 * @returns A promise that resolves to the response data for the interaction, or null if the command execution was handled manually.
	 */

	private static async _handleCommand(
		interaction: CommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction"> | null> {
		const command = CommandManager.get(interaction.commandName);

		if (!command) throw new Error(`Command '${interaction.commandName}' not found.`);

		if (!command.executeInteraction)
			throw new Error(
				`Command '${interaction.commandName}' has been registered without an executeInteraction method.`
			);

		// @ts-ignore - We know the type here is correct no matter what TS thinks.
		// I hate that I have to add a ts-ignore here though.
		return command.executeInteraction({ interaction, config });
	}

	/**
	 * Handles a component interaction by executing the corresponding component logic.
	 *
	 * @param interaction The ComponentInteraction to handle.
	 * @param config The guild configuration.
	 * @returns A promise that resolves to the response data for the interaction, or null if the component execution was handled manually.
	 */

	private static async _handleComponent(
		interaction: ComponentInteraction,
		config: GuildConfig
	): Promise<ResponseData<"interaction"> | null> {
		const component = ComponentManager.get(interaction.customId);

		if (!component)
			throw new Error(`Component '${interaction.customId}' not found in store.`);

		// @ts-ignore - We know the type here is correct no matter what TS thinks.
		// I hate that I have to add a ts-ignore here as well.
		return component.execute({ interaction, config });
	}
}
