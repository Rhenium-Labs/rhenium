import {
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle
} from "discord.js";

import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import BanRequestUtils, {
	BanRequestAction,
	BanRequestActionToPastTenseMap
} from "#utils/BanRequests.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^ban-request-(accept|deny|disregard)$/m }
})
export default class BanRequestButton extends Component {
	public async run(
		interaction: Component.Interaction<"button">,
		config: GuildConfig
	): Promise<InteractionReplyData | null> {
		if (!config.parseBanRequestsConfig())
			return { error: "Ban requests have not been configured on this server." };

		if (!config.data.ban_requests.enforce_deny_reason)
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const requestAction = interaction.customId
			.split("-")[2]
			.toLowerCase() as BanRequestAction;

		switch (requestAction) {
			case BanRequestAction.Disregard:
			case BanRequestAction.Accept: {
				// prettier-ignore
				const result = await BanRequestUtils.handle(
					interaction,
					config,
					requestAction
				);

				if (!result.ok) {
					return { error: result.message };
				}

				const formattedAction =
					BanRequestActionToPastTenseMap[requestAction].toLowerCase();

				return {
					content: `Successfully ${formattedAction} ban request - ID \`${interaction.message.id}\``,
					temporary: true
				};
			}

			case BanRequestAction.Deny:
				if (config.data.ban_requests.enforce_deny_reason) {
					const reasonTextInputBuilder = new TextInputBuilder()
						.setCustomId("reason")
						.setStyle(TextInputStyle.Paragraph)
						.setMaxLength(1024)
						.setMinLength(1)
						.setRequired(true);

					const reasonLabel = new LabelBuilder()
						.setLabel("Reason")
						.setTextInputComponent(reasonTextInputBuilder);

					const modal = new ModalBuilder()
						.setCustomId(`ban-request-deny-${interaction.message.id}`)
						.setTitle(`Deny Ban Request`)
						.addLabelComponents(reasonLabel);

					return interaction.showModal(modal).then(() => null);
				}

				// prettier-ignore
				const result = await BanRequestUtils.handle(
					interaction,
					config,
					requestAction
				);

				if (!result.ok) {
					return { error: result.message };
				}

				return {
					content: `Successfully denied ban request - ID \`${interaction.message.id}\``,
					temporary: true
				};
		}
	}
}
