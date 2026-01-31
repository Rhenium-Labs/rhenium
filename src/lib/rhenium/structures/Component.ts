import { Piece } from "@sapphire/pieces";
import type { Awaitable, ButtonInteraction, MessageComponentInteraction, ModalSubmitInteraction } from "discord.js";

import { client, kysely } from "#root/index.js";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#config/GuildConfig.js";

export abstract class Component<Options extends Component.Options = Component.Options> extends Piece<
	Options,
	"components"
> {
	/**
	 * The client this component is associated with.
	 */

	public client = client;

	/**
	 * Kysely client instance.
	 */

	public kysely = kysely;

	/**
	 * The component's custom ID
	 */

	public readonly id: Component.CustomID;

	/**
	 * Constructs a new component.
	 *
	 * @param context The loader context.
	 * @param options The component options.
	 * @returns A new Component instance.
	 */

	public constructor(context: Piece.LoaderContext<"components">, options: Options = {} as Options) {
		super(context, options);

		this.id = options.id;
	}

	/**
	 * Method used to be executed when the component is interacted with.
	 *
	 * @param interaction The component interaction.
	 * @param config The guild configuration.
	 *
	 * @returns The result of the component interaction.
	 */

	public abstract run(
		interaction: ComponentInteraction,
		config: GuildConfig
	): Awaitable<InteractionReplyData | null>;
}

interface ComponentOptions extends Piece.Options {
	/**
	 * The custom ID of the component.
	 */

	id: Component.CustomID;
}

export type ComponentCustomID =
	| string
	| { startsWith: string }
	| { endsWith: string }
	| { includes: string }
	| { matches: RegExp };

export type ComponentInteraction = MessageComponentInteraction<"cached"> | ModalSubmitInteraction<"cached">;

type InteractionGeneric = "button" | "modalSubmit";

export namespace Component {
	export type CustomID = ComponentCustomID;
	export type Options = ComponentOptions;
	export type Interaction<T extends InteractionGeneric> = T extends "button"
		? ButtonInteraction<"cached">
		: ModalSubmitInteraction<"cached">;
}
