import { MessageFlags } from "discord.js";
import type { ResponseData } from "#commands/Command.js";

import BanRequestUtils, { BanRequestAction } from "#utils/BanRequests.js";
import Component, { type ComponentExecutionContext } from "#components/Component.js";

export default class BanRequestDenyModal extends Component {
	constructor() {
		super({ matches: /^ban-request-deny-\d{17,19}$/m });
	}

	async execute({
		interaction,
		config
	}: ComponentExecutionContext<"modal">): Promise<ResponseData<"interaction"> | null> {
		if (!config.parseBanRequestsConfig())
			return { error: "Ban requests have not been configured on this server." };

		const requestAction = interaction.customId
			.split("-")[2]
			.toLowerCase() as BanRequestAction;
		const requestId = interaction.customId.split("-")[3];
		const reviewReason = interaction.fields.getTextInputValue("reason");

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const result = await BanRequestUtils.handle(
			interaction,
			config,
			requestAction,
			reviewReason
		);

		if (!result.ok) {
			return { error: result.message };
		}

		return { content: `Successfully denied the ban request - ID \`${requestId}\`` };
	}
}
