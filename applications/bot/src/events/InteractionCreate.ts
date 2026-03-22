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

import { getWhitelistStatus } from "#utils/index.js";
import { SENTRY_METRICS_COUNTERS } from "#utils/Constants.js";

import type { ResponseData } from "#commands/Command.js";
import type { ComponentInteraction } from "#components/Component.js";

import Logger from "#utils/Logger.js";
import GuildConfig from "#config/GuildConfig.js";
import GlobalConfig from "#config/GlobalConfig.js";
import EventListener from "#events/EventListener.js";
import ConfigManager from "#config/ConfigManager.js";
import CommandManager from "#commands/CommandManager.js";
import ComponentManager from "#components/ComponentManager.js";

export default class InteractionCreate extends EventListener {
	constructor() {
		super(Events.InteractionCreate);
	}

	async execute(interaction: Interaction): Promise<void> {
		if (!interaction.inCachedGuild()) return;

		const whitelisted = await getWhitelistStatus(interaction.guild.id);
		if (!whitelisted && !GlobalConfig.isDeveloper(interaction.user.id)) return;

		const config = await ConfigManager.getGuildConfig(interaction.guild.id);
		const identifier =
			interaction.isCommand() || interaction.isAutocomplete()
				? interaction.commandName
				: interaction.customId;

		return Result.fromAsync(() => InteractionCreate._handle(interaction, config)).then(
			result => {
				if (result.isErr()) {
					const error = result.unwrapErr();
					const sentryId = captureException(error, {
						user: {
							id: interaction.user.id,
							username: interaction.user.username
						},
						extra: {
							interactionId: interaction.id,
							interactionIdentifier: identifier,
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
							interaction_identifier: identifier
						}
					});

					Logger.traceable(sentryId, `Interaction execution failed:`, error);

					if (!interaction.isRepliable()) {
						// Can't reply to autocomplete interactions lol.
						return;
					}

					const content = `An error occurred while executing this interaction. Please use this ID when reporting the bug: \`${sentryId}\`.`;

					return void interaction[
						interaction.deferred || interaction.replied ? "followUp" : "reply"
					]({ content, flags: [MessageFlags.Ephemeral] }).catch(() => {});
				}

				const counter = interaction.isCommand()
					? SENTRY_METRICS_COUNTERS.CommandExecuted
					: SENTRY_METRICS_COUNTERS.ComponentExecuted;

				return metrics.count(counter, 1, {
					attributes: {
						guild_id: interaction.guild.id,
						interaction_type: interaction.type,
						interaction_identifier: identifier
					}
				});
			}
		);
	}

	/**
	 * Handles an interaction by determining its type and executing the appropriate command or component logic.
	 *
	 * @param interaction The interaction to handle, which can be either a CommandInteraction or a ComponentInteraction.
	 * @param config The guild configuration.
	 * @returns A promise that resolves when the interaction is handled.
	 */

	private static async _handle(
		interaction:
			| CommandInteraction<"cached">
			| ComponentInteraction
			| AutocompleteInteraction<"cached">,
		config: GuildConfig
	): Promise<void> {
		if (interaction.isAutocomplete()) {
			return InteractionCreate._handleAutocomplete(interaction);
		}

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
	 * Handles an autocomplete interaction by providing relevant suggestions based on the focused option.
	 *
	 * @param interaction The AutocompleteInteraction to handle.
	 * @returns A promise that resolves when the autocomplete response is sent.
	 */

	private static async _handleAutocomplete(interaction: AutocompleteInteraction<"cached">) {
		const option = interaction.options.getFocused(true);
		const value = option.value;
		const lowercaseValue = option.value.toString();

		const truncateRoleName = (name: string) =>
			name.length > 25 ? `${name.slice(0, 22)}...` : name;

		switch (option.name) {
			case "role": {
				const roles = interaction.guild.roles.cache
					.map(role => ({
						name: `@${truncateRoleName(role.name)}`,
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
