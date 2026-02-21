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

import { getWhitelistStatus } from "@utils/index";

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
			throw new Error("Autocomplete handling not implemented yet.");
		}

		const whitelisted = await getWhitelistStatus(interaction.guild.id);
		if (!whitelisted && !GlobalConfig.isDeveloper(interaction.user.id)) return;

		const config = await ConfigManager.get(interaction.guild.id);
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

			const content = `An error occurred while executing this interaction. Please use this ID when reporting the bug: \`${sentryId}\`.`;

			// We wrap the calls in `Result.fromAsync` to avoid Unknown Interaction errors.
			if (interaction.deferred || interaction.replied) {
				Result.fromAsync(() => interaction.editReply({ content }));
			} else {
				Result.fromAsync(() =>
					interaction.reply({ content, flags: [MessageFlags.Ephemeral] })
				);
			}

			Logger.traceable(
				sentryId,
				`An error occurred while handling an interaction:`,
				error
			);
			return;
		}
	}

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
