import {
	type APIEmbed,
	type GuildTextBasedChannel,
	type TopLevelComponent,
	ComponentType,
	Embed,
	MessageFlags,
	PermissionFlagsBits,
	userMention
} from "discord.js";

import { ApplyOptions, Component } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^delete-(original|reference)-report-message-\d{17,19}-\d{17,19}$/m }
})
export default class DeleteReportMessage extends Component {
	public async run(
		interaction: Component.Interaction<"button">
	): Promise<InteractionReplyData | null> {
		const type = interaction.customId.split("-")[1] as "original" | "reference";
		const channelId = interaction.customId.split("-")[4];
		const messageId = interaction.customId.split("-")[5];

		await interaction.deferUpdate();

		const gracefully = async (content: string): Promise<null> => {
			const components = DeleteReportMessage._getUpdatedComponents(
				interaction.message.components,
				type
			);

			return Promise.all([
				interaction.editReply({ embeds: interaction.message.embeds, components }),
				interaction.followUp({ content, flags: MessageFlags.Ephemeral })
			]).then(() => null);
		};

		const channel = await interaction.guild.channels
			.fetch(channelId)
			.then(channel => channel as GuildTextBasedChannel)
			.catch(() => null);

		if (!channel) {
			return gracefully(`Failed to fetch channel \`${channelId}\`.`);
		}

		if (
			!channel
				.permissionsFor(interaction.guild.members.me!)
				.has(PermissionFlagsBits.ManageMessages)
		) {
			return gracefully(`I do not have permission to manage messages in ${channel}.`);
		}

		if (!channel.permissionsFor(interaction.member).has(PermissionFlagsBits.ManageMessages)) {
			return gracefully(`You do not have permission to manage messages in ${channel}.`);
		}

		const message = await channel.messages.fetch(messageId).catch(() => null);

		if (!message) {
			return gracefully(`Failed to fetch message \`${messageId}\` in ${channel}.`);
		}

		const result = await message
			.delete()
			.then(() => ({ ok: true }))
			.catch(() => ({ ok: false }));

		if (!result.ok) {
			return interaction
				.followUp({
					content: `Failed to delete message \`${messageId}\` in ${channel}.`,
					flags: MessageFlags.Ephemeral
				})
				.then(() => null);
		}

		const components = DeleteReportMessage._getUpdatedComponents(
			interaction.message.components,
			type
		);

		const embeds = DeleteReportMessage._getUpdatedEmbeds(
			interaction.message.embeds,
			interaction.user.id,
			type
		);

		return Promise.all([
			interaction.editReply({ embeds, components }),
			interaction.followUp({
				content: `Successfully deleted message \`${messageId}\` in ${channel}.`,
				flags: MessageFlags.Ephemeral
			})
		]).then(() => null);
	}

	/**
	 * Updates the components to disable the delete button.
	 *
	 * @param components The original components.
	 * @param type The type of report message ("original" or "reference").
	 * @returns The updated components with the delete button disabled.
	 */

	private static _getUpdatedComponents(
		components: TopLevelComponent[],
		type: "original" | "reference"
	) {
		// Filter out every other component except action rows.
		return components
			.filter(c => c.type === ComponentType.ActionRow)
			.map(row => {
				return {
					type: row.type,
					components: row.components.map(component => {
						if (component.customId?.startsWith(`delete-${type}-report-message`)) {
							return { ...component.data, disabled: true };
						}

						return component.data;
					})
				};
			});
	}

	/**
	 * Updates the embeds to provide deletion notes.
	 *
	 * @param embeds The original embeds.
	 * @param userId The ID of the user who deleted the message.
	 * @param type The type of report message ("original" or "reference").
	 * @returns The updated embeds with deletion notes.
	 */

	private static _getUpdatedEmbeds(
		embeds: Embed[],
		userId: string,
		type: "original" | "reference"
	): APIEmbed[] {
		const targetAuthor = type === "reference" ? "Message Reference" : "New Message Report";
		const deletionType = type === "reference" ? "Reference Deleted" : "Message Deleted";
		const deletionNote = `${deletionType} (by ${userMention(userId)})`;

		return embeds.map(embed => {
			if (embed.author?.name !== targetAuthor) {
				return embed.toJSON();
			}

			const newEmbed = embed.toJSON();
			const existingFlagsIndex = newEmbed.fields?.findIndex(f => f.name === "Flags") ?? -1;

			if (existingFlagsIndex === -1) {
				newEmbed.fields = [
					...(newEmbed.fields ?? []),
					{ name: "Flags", value: deletionNote }
				];
			} else {
				const currentValue = newEmbed.fields![existingFlagsIndex].value;
				newEmbed.fields![existingFlagsIndex].value = currentValue
					? `${currentValue}, ${deletionNote}`
					: deletionNote;
			}

			return newEmbed;
		});
	}
}
