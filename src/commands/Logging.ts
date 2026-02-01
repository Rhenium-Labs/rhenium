import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	ChannelType,
	Colors,
	EmbedBuilder,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	channelMention
} from "discord.js";

import { client, kysely } from "#root/index.js";
import { ApplyOptions, Command } from "#rhenium";
import { LoggingEvent } from "#kysely/Enums.js";

import type { InteractionReplyData } from "#utils/Types.js";

import WebhookUtils from "#utils/Webhooks.js";

@ApplyOptions<Command.Options>({
	name: "logging",
	description: "Manage logging webhooks for the guild."
})
export default class Logging extends Command {
	register(): Command.Data {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			contexts: [InteractionContextType.Guild],
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
			options: [
				{
					name: LoggingSubcommandGroup.Webhooks,
					description: "Manage logging webhooks.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: LoggingSubcommand.Create,
							description:
								"Create a new logging webhook for the specified channel.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel to create the webhook in.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								},
								{
									name: "event",
									description: "The initial event to subscribe to.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(LoggingEvent).map(event => ({
										name: formatEventName(event),
										value: event
									}))
								}
							]
						},
						{
							name: LoggingSubcommand.Delete,
							description: "Delete a logging webhook.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel the webhook is in.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								}
							]
						},
						{
							name: LoggingSubcommand.List,
							description: "List all logging webhooks.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: LoggingSubcommandGroup.Events,
					description: "Manage events for logging webhooks.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: LoggingSubcommand.Add,
							description: "Add an event to an existing logging webhook.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel the webhook is in.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								},
								{
									name: "event",
									description: "The event to add.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(LoggingEvent).map(event => ({
										name: formatEventName(event),
										value: event
									}))
								}
							]
						},
						{
							name: LoggingSubcommand.Remove,
							description: "Remove an event from an existing logging webhook.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel the webhook is in.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								},
								{
									name: "event",
									description: "The event to remove.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(LoggingEvent).map(event => ({
										name: formatEventName(event),
										value: event
									}))
								}
							]
						},
						{
							name: LoggingSubcommand.View,
							description: "View events for a specific logging webhook.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel the webhook is in.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								}
							]
						}
					]
				}
			]
		};
	}

	async interactionRun(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const subcommand = interaction.options.getSubcommand(true) as LoggingSubcommand;
		const subcommandGroup = interaction.options.getSubcommandGroup(
			true
		) as LoggingSubcommandGroup;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		switch (subcommandGroup) {
			case LoggingSubcommandGroup.Webhooks:
				switch (subcommand) {
					case LoggingSubcommand.Create:
						return Logging._createWebhook(interaction);
					case LoggingSubcommand.Delete:
						return Logging._deleteWebhook(interaction);
					case LoggingSubcommand.List:
						return Logging._listWebhooks(interaction);
					default:
						return { error: "Unknown subcommand." };
				}
			case LoggingSubcommandGroup.Events:
				switch (subcommand) {
					case LoggingSubcommand.Add:
						return Logging._addEvent(interaction);
					case LoggingSubcommand.Remove:
						return Logging._removeEvent(interaction);
					case LoggingSubcommand.View:
						return Logging._viewWebhook(interaction);
					default:
						return { error: "Unknown subcommand." };
				}
			default:
				return { error: "Unknown subcommand group." };
		}
	}

	private static async _createWebhook(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const event = interaction.options.getString("event", true) as LoggingEvent;

		// Check if a webhook already exists for this channel.
		const existingWebhooks = await WebhookUtils.getWebhooks(interaction.guildId);
		const existingWebhook = existingWebhooks.find(wh => wh.channel_id === channel.id);

		if (existingWebhook) {
			return {
				error: `A logging webhook already exists in ${channel}. Use the \`add-event\` subcommand to add more events.`
			};
		}

		// Create a new webhook in the channel
		const webhook = await channel
			.createWebhook({
				name: client.user.username,
				avatar: client.user.displayAvatarURL()
			})
			.catch(() => null);

		if (!webhook) {
			return { error: `Failed to create a webhook in ${channel}.` };
		}

		// Store the webhook in the database
		await kysely
			.insertInto("LoggingWebhook")
			.values({
				id: webhook.id,
				url: webhook.url,
				token: webhook.token,
				channel_id: channel.id,
				guild_id: interaction.guildId,
				events: [event]
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		return {
			content: `Successfully created a logging webhook in ${channel} with the event \`${formatEventName(event)}\`.`
		};
	}

	private static async _deleteWebhook(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);

		// Find the webhook for this channel
		const webhooks = await WebhookUtils.getWebhooks(interaction.guildId);
		const webhook = webhooks.find(wh => wh.channel_id === channel.id);

		if (!webhook) {
			return { error: `No logging webhook found in ${channel}.` };
		}

		// Try to delete the Discord webhook
		const guildWebhooks = await interaction.guild.fetchWebhooks().catch(() => null);

		if (guildWebhooks) {
			const discordWebhook = guildWebhooks.get(webhook.id);

			if (discordWebhook) {
				await discordWebhook.delete().catch(() => null);
			}
		}

		// Delete from the database
		await kysely
			.deleteFrom("LoggingWebhook")
			.where("id", "=", webhook.id)
			.where("guild_id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully deleted the logging webhook in ${channel}.`
		};
	}

	private static async _listWebhooks(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const webhooks = await WebhookUtils.getWebhooks(interaction.guildId);

		if (webhooks.length === 0) {
			return { content: "There are no logging webhooks configured for this guild." };
		}

		const description = webhooks
			.map(webhook => {
				const eventList =
					webhook.events.length > 0
						? webhook.events.map(e => `\`${formatEventName(e)}\``).join(", ")
						: "*No events*";
				return `${channelMention(webhook.channel_id)}\n└ ${eventList}`;
			})
			.join("\n\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Logging Webhooks in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(description)
			.setFooter({
				text: `${webhooks.length} webhook${webhooks.length === 1 ? "" : "s"} configured`
			})
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _addEvent(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const event = interaction.options.getString("event", true) as LoggingEvent;

		// Find the webhook for this channel
		const webhooks = await WebhookUtils.getWebhooks(interaction.guildId);
		const webhook = webhooks.find(wh => wh.channel_id === channel.id);

		if (!webhook) {
			return {
				error: `No logging webhook found in ${channel}. Create one with the \`create\` subcommand first.`
			};
		}

		if (webhook.events.includes(event)) {
			return {
				error: `The event \`${formatEventName(event)}\` is already subscribed to for this webhook.`
			};
		}

		await WebhookUtils.addEvents(webhook.id, interaction.guildId, [event]);

		return {
			content: `Successfully added the event \`${formatEventName(event)}\` to the webhook in ${channel}.`
		};
	}

	private static async _removeEvent(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const event = interaction.options.getString("event", true) as LoggingEvent;

		// Find the webhook for this channel
		const webhooks = await WebhookUtils.getWebhooks(interaction.guildId);
		const webhook = webhooks.find(wh => wh.channel_id === channel.id);

		if (!webhook) {
			return { error: `No logging webhook found in ${channel}.` };
		}

		if (!webhook.events.includes(event)) {
			return {
				error: `The event \`${formatEventName(event)}\` is not subscribed to for this webhook.`
			};
		}

		const updatedWebhook = await WebhookUtils.removeEvents(webhook.id, interaction.guildId, [
			event
		]);

		if (updatedWebhook && updatedWebhook.events.length === 0) {
			return {
				content: `Successfully removed the event \`${formatEventName(event)}\` from the webhook in ${channel}. ⚠️ This webhook now has no events and won't receive any logs.`
			};
		}

		return {
			content: `Successfully removed the event \`${formatEventName(event)}\` from the webhook in ${channel}.`
		};
	}

	private static async _viewWebhook(
		interaction: Command.Interaction<"chatInput">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);

		// Find the webhook for this channel
		const webhooks = await WebhookUtils.getWebhooks(interaction.guildId);
		const webhook = webhooks.find(wh => wh.channel_id === channel.id);

		if (!webhook) {
			return { error: `No logging webhook found in ${channel}.` };
		}

		const eventList =
			webhook.events.length > 0
				? webhook.events.map(e => `• \`${formatEventName(e)}\``).join("\n")
				: "*No events configured*";

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Logging Webhook Details`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.addFields(
				{ name: "Channel", value: channelMention(webhook.channel_id), inline: true },
				{ name: "Webhook ID", value: `\`${webhook.id}\``, inline: true },
				{ name: "Events", value: eventList }
			)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}
}

/**
 * Formats an event name for display.
 * Converts PascalCase to Title Case with spaces.
 */
function formatEventName(event: LoggingEvent): string {
	return event.replace(/([A-Z])/g, " $1").trim();
}

enum LoggingSubcommand {
	Create = "create",
	Delete = "delete",
	List = "list",
	Add = "add",
	Remove = "remove",
	View = "view"
}

enum LoggingSubcommandGroup {
	Webhooks = "webhooks",
	Events = "events"
}
