import { capitalize } from "#utils/index.js";
import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";
import BanRequestUtils, { BanRequestAction } from "#utils/BanRequests.js";

const AUTO_DELETE_DELAY = 7000;

@ApplyOptions<Component.Options>({
	id: { matches: /^ban-request-(accept|deny)-\d{17,19}$/m }
})
export default class BanRequestModal extends Component {
	public async run(
		interaction: Component.Interaction<"modalSubmit">,
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
