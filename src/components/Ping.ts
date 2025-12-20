import { Component } from "#classes/Component.js";
import { InteractionReplyData } from "#utils/Types.js";

export default class Ping extends Component {
	public constructor() {
		super("ping");
	}

	public async run(): Promise<InteractionReplyData> {
		return {
			content: `Pong! 🏓`
		};
	}
}
