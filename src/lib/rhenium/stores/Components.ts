import { MessageFlags } from "discord.js";
import { captureException } from "@sentry/node";
import { LoaderStrategy, Store } from "@sapphire/pieces";

import { inflect } from "#utils/index.js";
import { processResponse } from "#rhenium";
import { Component, type ComponentCustomID, type ComponentInteraction } from "../structures/Component.js";

import Logger from "#utils/Logger.js";
import ConfigManager from "#config/ConfigManager.js";

export default class ComponentStore extends Store<Component, "components"> {
	public constructor() {
		super(Component, {
			name: "components",
			strategy: new ComponentLoaderStrategy()
		});
	}

	/**
	 * Get a component from the cache by its custom ID.
	 *
	 * @param customId The custom ID of the component.
	 * @returns The component if found, otherwise undefined.
	 */
	public override get(customId: string): Component | undefined {
		return this.find(component => {
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

	/** Handles component execution for interactions. */
	public async handleComponent(interaction: ComponentInteraction): Promise<any> {
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

		const config = await ConfigManager.get(interaction.guild.id);

		try {
			const response = await component.run(interaction, config);
			return processResponse("Interaction", { interaction, response });
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

			Logger.error(`Error executing component "${component.id}":`, error);

			const content = `An error occurred while executing this component. Please include this ID when reporting the bug: \`${sentryId}\`.`;

			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content: content });
			} else {
				await interaction.reply({ content: content, flags: [MessageFlags.Ephemeral] });
			}
		}
	}
}

/** Custom loader strategy for components. */
class ComponentLoaderStrategy extends LoaderStrategy<Component> {
	public override async onLoadAll(store: ComponentStore) {
		return Logger.info(`Loaded ${store.size} ${inflect(store.size, "component")}.`);
	}

	public override async onLoad(_: ComponentStore, piece: Component) {
		return Logger.custom(
			"COMPONENTS",
			`Loaded component "${ComponentLoaderStrategy.parseComponentCustomId(piece.id)}".`,
			{
				color: "Cyan"
			}
		);
	}

	/**
	 * Parses a string/object custom ID to a string.
	 *
	 * @param customId The custom ID to parse.
	 * @returns The parsed custom ID as a string.
	 */
	public static parseComponentCustomId(customId: ComponentCustomID): string {
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
