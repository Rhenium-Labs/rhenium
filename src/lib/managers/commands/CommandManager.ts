import {
	type ApplicationCommandData,
	Collection,
	Colors,
	CommandInteraction,
	InteractionReplyOptions,
	Message,
	MessageFlags,
	PermissionFlagsBits
} from "discord.js";
import { captureException } from "@sentry/node";
import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { reply } from "#utils/Messages.js";
import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import Command from "./Command.js";
import ConfigManager from "#managers/config/ConfigManager.js";

export default class CommandManager {
	/** Collection of all cached commands. */
	private static readonly _cache: Collection<string, Command> = new Collection();

	/**
	 * Get a command from the cache.
	 *
	 * @param name The name or alias of the command.
	 * @returns The command if found, otherwise undefined.
	 */
	public static get(name: string): Command | undefined {
		return this._cache.get(name);
	}

	/** Cache all commands from the `commands` directory. */
	public static async cache(): Promise<void> {
		const directory = path.resolve("dist/commands");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Commands directory not found: ${directory}`);
			process.exit(1);
		}

		Logger.info("Caching commands...");

		const filenames = fs.readdirSync(directory).filter(file => file.endsWith(".js"));
		let count = 0;

		for (const filename of filenames) {
			const filepath = path.resolve(directory, filename);
			const url = pathToFileURL(filepath);

			const commandClass = (await import(url.href)).default;
			const command = new commandClass();

			if (!(command instanceof Command)) {
				Logger.warn(`${filename} is not a valid command.`);
				continue;
			}

			if (command.aliases.length) {
				for (const alias of command.aliases) {
					this._cache.set(alias, command);
				}
			}

			this._cache.set(command.name, command);
			count++;

			Logger.custom("COMMANDS", `Cached command "${command.name}".`, { color: "Purple" });
		}

		Logger.info(`Cached ${count} ${inflect(count, "command")}.`);
	}

	/** Registers application commands with Discord. */
	public static async register(): Promise<void> {
		const commands: ApplicationCommandData[] = this._cache
			.filter(cmd => cmd.register !== undefined)
			.map(cmd => cmd.register!());

		if (commands.length === 0) {
			Logger.info("Found no application commands to register.");
			return;
		}

		const set = await client.application.commands
			.set(commands)
			.then(() => ({ success: true, error: null }))
			.catch(error => ({ success: false, error }));

		if (!set.success) {
			Logger.error("Failed to register application commands:", set.error);
			process.exit(1);
		}

		Logger.success(`Registered ${commands.length} ${inflect(commands.length, "application command")}.`);
	}

	/** Handles command execution for application commands. */
	public static async handleApplicationCommand(interaction: CommandInteraction<"cached">): Promise<any> {
		const command = this.get(interaction.commandName);

		if (!command) {
			const sentryId = captureException(new Error("Unknown Command Interaction."), {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					interactionId: interaction.id,
					interactionIdentifier: interaction.commandName,
					channelId: interaction.channel?.id,
					guildId: interaction.guild.id
				}
			});

			return interaction.reply({
				content: `An error occurred while executing this command. Please include this ID when reporting the bug: \`${sentryId}\`.`,
				flags: [MessageFlags.Ephemeral]
			});
		}

		if (!command.interactionRun) {
			const sentryId = captureException(new Error("Command Missing Handler."), {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					channelId: interaction.channel?.id,
					guildId: interaction.guild.id,
					interactionId: interaction.id,
					interactionIdentifier: interaction.commandName
				}
			});

			return interaction.reply({
				content: `An error occurred while executing this command. Please include this ID when reporting the bug: \`${sentryId}\`.`,
				flags: [MessageFlags.Ephemeral]
			});
		}

		const config = await ConfigManager.getGuildConfig(interaction.guild.id);

		try {
			const response = await command.interactionRun(interaction, config);

			// Reply was handled manually.
			if (response === null) return;

			const { error, temporary, ...options } = response;

			const defaultReplyOptions = {
				flags: [MessageFlags.Ephemeral],
				allowedMentions: { parse: [] }
			} as const;

			const replyOptions: InteractionReplyOptions = error
				? {
						...defaultReplyOptions,
						...options,
						embeds: [{ description: error, color: Colors.Red }, ...(options.embeds ?? [])]
					}
				: { ...defaultReplyOptions, ...options };

			if (interaction.deferred || interaction.replied) {
				const { flags, ...options } = replyOptions;
				await interaction.editReply(options);
			} else {
				await interaction.reply(replyOptions);
			}

			if (error || temporary) {
				setTimeout(() => {
					interaction.deleteReply().catch(() => {});
				}, 7500);
			}
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					channelId: interaction.channel?.id,
					guildId: interaction.guild.id,
					interactionId: interaction.id,
					interactionIdentifier: interaction.commandName
				}
			});

			const content = `An error occurred while executing this command. Please include this ID when reporting the bug: \`${sentryId}\`.`;

			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content: content });
			} else {
				await interaction.reply({ content: content, flags: [MessageFlags.Ephemeral] });
			}
		}
	}

	/** Handles execution for message commands. */
	public static async handleMessageCommand(message: Message<true>): Promise<any> {
		if (!message.content.startsWith(".")) return;
		if (!message.channel.permissionsFor(message.guild.members.me!).has(PermissionFlagsBits.SendMessages)) return;

		const trimmed = message.content.slice(".".length).trim();
		const spaceIndex = trimmed.indexOf(" ");

		const commandName = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
		if (!commandName.length) return;

		const command = this.get(commandName);

		// No need to handle unknown commands here.
		if (!command) return;

		// No need to handle commands without a handler.
		// They're simply not meant to be used as message commands.
		if (!command.messageRun) return;

		const config = await ConfigManager.getGuildConfig(message.guild.id);

		const parameters = spaceIndex === -1 ? "" : trimmed.substring(spaceIndex + 1).trim();
		const args = command.getArgumentParser(message, parameters);

		try {
			const response = await command.messageRun(message, args, config);

			// Reply was handled manually.
			if (response === null) return;

			const { error, temporary, ...options } = response;

			const replyOptions = error
				? { ...options, embeds: [{ description: error, color: Colors.Red }, ...(options.embeds ?? [])] }
				: options;

			const status = await reply(message, replyOptions);

			if (error || temporary) {
				setTimeout(() => status?.delete().catch(() => {}), 7500);
			}
		} catch (error) {
			const sentryId = captureException(error, {
				user: { id: message.author.id, username: message.author.username },
				extra: {
					guildId: message.guild.id,
					channelId: message.channel.id,
					messageId: message.id
				}
			});

			return reply(message, {
				content: `An error occurred while executing this command. Please include this ID when reporting the bug: \`${sentryId}\`.`
			}).catch(() => {});
		}
	}
}
