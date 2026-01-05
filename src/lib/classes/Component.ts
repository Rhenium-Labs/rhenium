import type { Awaitable, MessageComponentInteraction, ModalSubmitInteraction } from "discord.js";

import { client, prisma } from "#root/index.js";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "./GuildConfig.js";

export default abstract class Component {
	/**
	 * The client this component is associated with.
	 */

	public client = client;

	/**
	 * Prisma client instance.
	 */

	public prisma = prisma;

	/**
	 * The component's custom ID.
	 */

	public readonly id: ComponentCustomID;

	/**
	 * Constructs a new component.
	 *
	 * @param customId The custom ID for the component.
	 * @returns A new Component instance.
	 */

	public constructor(customId: ComponentCustomID) {
		this.id = customId;
	}

	/**
	 * Method used to be executed when the component is interacted with.
	 *
	 * @param interaction The component interaction.
	 * @returns The result of the component interaction.
	 */

	abstract run(interaction: ComponentInteraction, config: GuildConfig): Awaitable<InteractionReplyData | null>;
}

export type ComponentCustomID =
	| string
	| { startsWith: string }
	| { endsWith: string }
	| { includes: string }
	| { matches: RegExp };

export type ComponentInteraction = MessageComponentInteraction<"cached"> | ModalSubmitInteraction<"cached">;
