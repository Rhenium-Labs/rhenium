import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

import { kysely } from "#root/index.js";
import { ApplyOptions, Component } from "#rhenium";
import { capitalize, userMentionWithId } from "#utils/index.js";

import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import RequestAction, { BanRequestAction } from "#root/commands/RequestAction.js";

const AUTO_DELETE_DELAY = 7000;

@ApplyOptions<Component.Options>({
	id: { matches: /^ban-request-(accept|deny|disregard)$/m }
})
export default class BanRequestButton extends Component {
	public async run(
		interaction: Component.Interaction<"button">,
		configClass: GuildConfig
	): Promise<InteractionReplyData | null> {
		const config = configClass.getBanRequestsConfig();

		if (!configClass.hasPermission(interaction.member, "ReviewBanRequests")) {
			return { error: "You do not have permission to review ban requests." };
		}

		if (!config) {
			return { error: "Ban requests are not configured for this server." };
		}

		const action = capitalize(interaction.customId.split("-")[2]) as BanRequestAction;
		const request = await kysely
			.selectFrom("BanRequest")
			.selectAll()
			.where("id", "=", interaction.message!.id)
			.executeTakeFirst();

		if (!request) {
			setTimeout(() => interaction.message?.delete().catch(() => null), AUTO_DELETE_DELAY);

			return {
				error: "Failed to find the ban request associated with this message. I will attempt to delete this submission in 7 seconds."
			};
		}

		if (request.resolved_by) {
			setTimeout(() => interaction.message?.delete().catch(() => null), AUTO_DELETE_DELAY);

			return {
				error: `This request has already been resolved by ${userMentionWithId(request.resolved_by)}. I will attempt to delete this submission in 7 seconds.`
			};
		}

		if (action === BanRequestAction.Disregard) {
			return RequestAction.processBanRequest({ interaction, request, action, config, reviewReason: null });
		}

		const requiresReason =
			(action === BanRequestAction.Accept && config.enforce_accept_reason) ||
			(action === BanRequestAction.Deny && config.enforce_deny_reason);

		if (requiresReason) {
			await interaction.showModal(buildReasonModal(request.id, action));
			return null;
		}

		return RequestAction.processBanRequest({
			interaction,
			config,
			action,
			request,
			reviewReason: null
		});
	}
}

/**
 * Builds a modal for collecting a reason for the ban request action.
 */
function buildReasonModal(requestId: string, action: BanRequestAction): ModalBuilder {
	const reasonInput = new TextInputBuilder()
		.setCustomId("reason")
		.setStyle(TextInputStyle.Paragraph)
		.setMaxLength(1024)
		.setMinLength(1)
		.setRequired(true);

	const reasonLabel = new LabelBuilder().setLabel("Reason").setTextInputComponent(reasonInput);

	return new ModalBuilder()
		.setCustomId(`ban-request-${action.toLowerCase()}-${requestId}`)
		.setTitle(`${action} Ban Request`)
		.addLabelComponents(reasonLabel);
}
