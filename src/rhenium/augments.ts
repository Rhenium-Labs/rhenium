import CommandStore from "./stores/Commands.js";
import ComponentStore from "./stores/Components.js";
import EventListenerStore from "./stores/EventListeners.js";

declare module "@sapphire/pieces" {
	interface StoreRegistryEntries {
		commands: CommandStore;
		components: ComponentStore;
		events: EventListenerStore;
	}
}
