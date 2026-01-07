import { Collection, MessageFlags } from "discord.js";
import { captureException } from "@sentry/node";
import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { inflect } from "#utils/index.js";
import { processResponse } from "#managers/commands/CommandManager.js";

import Logger from "#utils/Logger.js";
import Component, { ComponentInteraction, type ComponentCustomID } from "./Component.js";
import ConfigManager from "#managers/config/ConfigManager.js";

export default class ComponentManager {
	/** Collection of all cached components. */
	private static readonly _cache: Collection<ComponentCustomID, Component> = new Collection();

	/**
	 * Get a component from the cache by its custom ID.
	 *
	 * @param customId The custom ID of the component.
	 * @returns The component if found, otherwise undefined.
	 */
	public static get(customId: string): Component | undefined {
		return this._cache.find(component => {
			if (typeof component.id === "string") {
				return component.id === customId;
			}

			if ("matches" in component.id) {
				return customId.match(component.id.matches);
			}

			if ("startsWith" in component.id) {
				return customId.startsWith(component.id.startsWith);
			}

			if ("endsWith" in component.id) {
				return customId.endsWith(component.id.endsWith);
			}

			return customId.includes(component.id.includes);
		});
	}

	/** Cache all components from the `components` directory. */
	public static async cache(): Promise<void> {
		const directory = path.resolve("dist/components");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Components directory not found: ${directory}`);
			process.exit(1);
		}

		Logger.info("Caching components...");

		const filenames = fs.readdirSync(directory).filter(file => file.endsWith(".js"));
		let count = 0;

		for (const filename of filenames) {
			const filepath = path.resolve(directory, filename);
			const url = pathToFileURL(filepath);

			const componentClass = (await import(url.href)).default;
			const component = new componentClass();

			if (!(component instanceof Component)) {
				Logger.warn(`${filename} is not a valid component.`);
				continue;
			}

			this._cache.set(component.id, component);
			count++;

			Logger.custom("COMPONENTS", `Cached component "${this._parseComponentCustomId(component.id)}".`, {
				color: "Cyan"
			});
		}

		Logger.info(`Cached ${count} ${inflect(count, "component")}.`);
	}

	/** Handles component execution for interactions. */
	public static async handleComponent(interaction: ComponentInteraction): Promise<any> {
		const component = this.get(interaction.customId);

		if (!component) {
			const sentryId = captureException(new Error("Unknown Component Interaction."), {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					interactionId: interaction.id,
					interactionIdentifier: interaction.customId,
					channelId: interaction.channel?.id,
					guildId: interaction.guild.id
				}
			});

			return interaction.reply({
				content: `An error occurred while executing this component. Please include this ID when reporting the bug: \`${sentryId}\`.`,
				flags: [MessageFlags.Ephemeral]
			});
		}

		const config = await ConfigManager.getGuildConfig(interaction.guild.id);

		try {
			const response = await component.run(interaction, config);
			await processResponse("Interaction", { interaction, response });
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					id: interaction.user.id,
					username: interaction.user.username
				},
				extra: {
					interactionId: interaction.id,
					interactionIdentifier: interaction.customId,
					channelId: interaction.channel?.id,
					guildId: interaction.guild.id
				}
			});

			const content = `An error occurred while executing this component. Please include this ID when reporting the bug: \`${sentryId}\`.`;

			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content: content });
			} else {
				await interaction.reply({ content: content, flags: [MessageFlags.Ephemeral] });
			}
		}
	}

	/**
	 * Parses a string/object custom ID to a string.
	 *
	 * @param customId The custom ID to parse.
	 * @returns The parsed custom ID as a string.
	 */
	private static _parseComponentCustomId(customId: ComponentCustomID): string {
		if (typeof customId === "string") {
			return customId;
		}

		switch (true) {
			case "matches" in customId:
				return `matches(${customId.matches.toString()})`;
			case "startsWith" in customId:
				return `startsWith(${customId.startsWith})`;
			case "endsWith" in customId:
				return `endsWith(${customId.endsWith})`;
			case "includes" in customId:
				return `includes(${customId.includes})`;
			default:
				return "unknown";
		}
	}
}
