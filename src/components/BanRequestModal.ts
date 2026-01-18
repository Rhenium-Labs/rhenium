import type { ModalSubmitInteraction } from "discord.js";

import { capitalize } from "#utils/index.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Component from "#managers/components/Component.js";
import GuildConfig from "#managers/config/GuildConfig.js";
import BanRequestUtils, { BanRequestAction } from "#utils/BanRequests.js";

const AUTO_DELETE_DELAY = 7000;

export default class BanRequestModal extends Component {
	public constructor() {
		super({ matches: /^ban-request-(accept|deny)-\d{17,19}$/m });
	}

	public async run(
		interaction: ModalSubmitInteraction<"cached">,
		configClass: GuildConfig
	): Promise<InteractionReplyData | null> {
		const config = configClass.getBanRequestsConfig();

		if (!config) {
			return { error: "Ban requests are not configured for this server." };
		}

		const action = capitalize(interaction.customId.split("-")[2]) as BanRequestAction;
		const requestId = interaction.customId.split("-")[3];

		const request = await this.prisma.banRequest.findUnique({
			where: { id: requestId, guild_id: interaction.guild.id }
		});

		if (!request) {
			setTimeout(() => interaction.message?.delete().catch(() => null), AUTO_DELETE_DELAY);
			return {
				error: "Failed to find the ban request associated with this message. I will attempt to delete this submission in 7 seconds."
			};
		}

		const reviewReason = interaction.fields.getTextInputValue("reason");

		return BanRequestUtils.process({
			interaction,
			config,
			action,
			request,
			reviewReason
		});
	}
}
