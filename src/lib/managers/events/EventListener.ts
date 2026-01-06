import { type Awaitable, Events } from "discord.js";
import { client, prisma } from "#root/index.js";

export default abstract class EventListener {
	/**
	 * The client this listener is attached to.
	 */

	public client = client;

	/**
	 * The Prisma client instance.
	 */

	public prisma = prisma;

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
	 * @param event The event this listener listens to.
	 * @param once Whether this listener should only run once.
	 * @returns The constructed event listener.
	 */

	public constructor(event: Events | string, once = false) {
		this.event = event;
		this.once = once;
	}

	/**
	 * Method to be executed when the event is emitted.
	 *
	 * @param args The arguments emitted with the event.
	 * @returns Unknown.
	 */

	public abstract onEmit(...args: unknown[]): Awaitable<unknown>;
}
