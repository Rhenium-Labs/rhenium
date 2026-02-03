import { MessageFlags } from "discord.js";
import { ApplyOptions, Component } from "#rhenium";

import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import BanRequestUtils, { BanRequestAction } from "#utils/BanRequests.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^ban-request-deny-\d{17,19}$/m }
})
export default class BanRequestDenyModal extends Component {
	public async run(
		interaction: Component.Interaction<"modalSubmit">,
		config: GuildConfig
	): Promise<InteractionReplyData | null> {
		if (!config.getBanRequestsConfig())
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
