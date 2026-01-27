import { captureException } from "@sentry/node";
import { AliasStore, LoaderStrategy } from "@sapphire/pieces";
import {
	MessageFlags,
	PermissionFlagsBits,
	type ApplicationCommandData,
	type CommandInteraction,
	type Message
} from "discord.js";

import { reply } from "#utils/Messages.js";
import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";
import { Command } from "../structures/Command.js";
import { processResponse } from "#rhenium";

import Logger from "#utils/Logger.js";

import ConfigManager from "#root/lib/config/ConfigManager.js";

export default class CommandStore extends AliasStore<Command, "commands"> {
	public constructor() {
		super(Command, {
			name: "commands",
			strategy: new CommandLoaderStrategy()
		});
	}

	/** Registers application commands with Discord. */
	public async register(): Promise<void> {
		const commands: ApplicationCommandData[] = this.filter(cmd => cmd.register !== undefined).map(cmd =>
			cmd.register!()
		);

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
	public async handleApplicationCommand(interaction: CommandInteraction<"cached">): Promise<any> {
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

		const config = await ConfigManager.get(interaction.guild.id);

		try {
			const response = await command.interactionRun(interaction, config);
			return processResponse("Interaction", { interaction, response });
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
	public async handleMessageCommand(message: Message<true>): Promise<any> {
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

		const config = await ConfigManager.get(message.guild.id);

		const parameters = spaceIndex === -1 ? "" : trimmed.substring(spaceIndex + 1).trim();
		const args = command.getArgumentParser(message, parameters);

		try {
			const response = await command.messageRun(message, args, config);
			return processResponse("Message", { message, response });
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

/** Custom command loader strategy to publish commands once they're fully loaded. */
class CommandLoaderStrategy extends LoaderStrategy<Command> {
	public override async onLoadAll(store: CommandStore) {
		return Logger.info(`Loaded ${store.size} ${inflect(store.size, "command")}.`);
	}

	public override async onLoad(_: CommandStore, piece: Command) {
		return Logger.custom("COMMANDS", `Loaded command "${piece.name}".`, { color: "Purple" });
	}
}
