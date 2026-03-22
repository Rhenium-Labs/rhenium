import type {
	Awaitable,
	ButtonInteraction,
	MessageComponentInteraction,
	ModalSubmitInteraction
} from "discord.js";

import { client, kysely } from "#root/index.js";
import type { ResponseData } from "../commands/Command.js";

import GuildConfig from "#config/GuildConfig.js";

export default abstract class Component {
	/**
	 * The client this component is associated with.
	 */

	readonly client = client;

	/**
	 * Kysely client instance.
	 */

	readonly kysely = kysely;

	/**
	 * The component's custom ID.
	 */

	readonly customId: ComponentCustomID;

	/**
	 * Constructs a new component.
	 *
	 * @param customId The custom ID of the component.
	 * @returns A new Component instance.
	 */

	protected constructor(customId: ComponentCustomID) {
		this.customId = customId;
	}

	/**
	 * Method to be executed when the component is interacted with.
	 *
	 * @param context The component execution context.
	 * @returns The response data for the component execution.
	 */

	abstract execute(
		context: ComponentExecutionContext<"modal" | "button">
	): Awaitable<ResponseData<"interaction"> | null>;
}

export type ComponentCustomID =
	| string
	| { startsWith: string }
	| { endsWith: string }
	| { includes: string }
	| { matches: RegExp };

export type ComponentInteraction =
	| MessageComponentInteraction<"cached">
	| ModalSubmitInteraction<"cached">;

export type ComponentExecutionContext<T extends "button" | "modal"> = {
	config: GuildConfig;
} & (T extends "button"
	? { interaction: ButtonInteraction<"cached"> }
	: { interaction: ModalSubmitInteraction<"cached"> });
