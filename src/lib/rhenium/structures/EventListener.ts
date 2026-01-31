import { Piece } from "@sapphire/pieces";
import { Awaitable, Events } from "discord.js";

import { client, kysely } from "#root/index.js";

export abstract class EventListener<Options extends EventListener.Options = EventListener.Options> extends Piece<
	Options,
	"events"
> {
	/**
	 * The client this listener is attached to.
	 */

	public client = client;

	/**
	 * Kysely client instance.
	 */

	public kysely = kysely;

	/**
	 * The event this listener listens to.
	 */

	public readonly event: Events | string;

	/**
	 * Whether this listener should only run once.
	 */

	public readonly once: boolean;

	/**
	 * Constructs a new event listener.
	 *
	 * @param context The loader context.
	 * @param options The event listener options.
	 * @returns The constructed event listener.
	 */

	public constructor(context: Piece.LoaderContext<"events">, options: Options = {} as Options) {
		super(context, options);

		this.event = options.event;
		this.once = options.once ?? false;
	}

	/**
	 * Method to be executed when the event is emitted.
	 *
	 * @param args The arguments emitted with the event.
	 * @returns Unknown.
	 */

	public abstract onEmit(...args: unknown[]): Awaitable<unknown>;
}

interface EventListenerOptions extends Piece.Options {
	event: Events | string;
	once?: boolean;
}

export namespace EventListener {
	export type Options = EventListenerOptions;
}
