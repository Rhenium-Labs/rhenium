import { client, kysely } from "#root/index.js";
import type { Events } from "discord.js";

export default abstract class EventListener {
	/**
	 * The client this listener is attached to.
	 */

	readonly client = client;

	/**
	 * Kysely client instance.
	 */

	readonly kysely = kysely;

	/**
	 * The event this listener listens to.
	 */

	readonly event: Events | string;

	/**
	 * Whether this listener should only run once.
	 */

	readonly once: boolean;

	/**
	 * Constructs a new event listener.
	 *
	 * @param event The event this listener listens to.
	 * @param once Whether this listener should only run once.
	 * @returns A new EventListener instance.
	 */

	protected constructor(event: Events | string, once?: boolean) {
		this.event = event;
		this.once = once ?? false;
	}

	/**
	 * Method to be executed when the event is emitted.
	 *
	 * @param args The arguments emitted with the event.
	 * @returns Unknown.
	 */

	abstract execute(...args: any[]): unknown;
}
