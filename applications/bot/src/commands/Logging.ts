import {
	type ApplicationCommandData,
	type ChatInputCommandInteraction,
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

import { client, kysely } from "@root/index";
import { LoggingEvent, LoggingWebhook } from "@config/Schema";

import GuildConfig from "@config/GuildConfig";
import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "@commands/Command";
import ConfigManager from "@config/ConfigManager";

export default class Logging extends Command {
	constructor() {
		super({
			name: "logging",
			description: "Manage logging webhooks and their events.",
			category: CommandCategory.Management
		});
	}

	override register(): ApplicationCommandData {
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

	override async executeInteraction({
		interaction,
		config
	}: CommandExecutionContext<"chatInputCmd">): Promise<ResponseData<"interaction">> {
		const subcommand = interaction.options.getSubcommand(true) as LoggingSubcommand;
		const subcommandGroup = interaction.options.getSubcommandGroup(
			true
		) as LoggingSubcommandGroup;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		switch (subcommandGroup) {
			case LoggingSubcommandGroup.Webhooks:
				switch (subcommand) {
					case LoggingSubcommand.Create:
						return Logging._createWebhook(interaction, config);
					case LoggingSubcommand.Delete:
						return Logging._deleteWebhook(interaction, config);
					case LoggingSubcommand.List:
						return Logging._listWebhooks(interaction, config);
				}
			case LoggingSubcommandGroup.Events:
				switch (subcommand) {
					case LoggingSubcommand.Add:
						return Logging._addEvent(interaction, config);
					case LoggingSubcommand.Remove:
						return Logging._removeEvent(interaction, config);
					case LoggingSubcommand.View:
						return Logging._viewWebhook(interaction, config);
				}
		}

		return { error: "Unknown subcommand." };
	}

	private static async _createWebhook(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const event = interaction.options.getString("event", true) as LoggingEvent;

		const existingWebhooks = config.data.logging_webhooks;
		const existingWebhook = existingWebhooks.find(wh => wh.channel_id === channel.id);

		if (existingWebhook)
			return {
				error: `A logging webhook already exists in ${channel}. Use the \`add-event\` subcommand to add more events.`
			};

		const webhook = await channel
			.createWebhook({
				name: client.user.username,
				avatar: client.user.displayAvatarURL()
			})
			.catch(() => null);

		if (!webhook) return { error: `Failed to create a webhook in ${channel}.` };

		const webhookData: LoggingWebhook = {
			id: webhook.id,
			url: webhook.url,
			token: webhook.token,
			channel_id: channel.id,
			events: [event]
		};
		const updatedWebhooks: LoggingWebhook[] = [...existingWebhooks, webhookData];
		const updatedConfig = { ...config.data, logging_webhooks: updatedWebhooks };

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully created a logging webhook in ${channel} with the event \`${formatEventName(event)}\`.`
		};
	}

	private static async _deleteWebhook(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);

		const webhooks = config.data.logging_webhooks;
		const webhook = webhooks.find(wh => wh.channel_id === channel.id);

		if (!webhook) {
			return { error: `No logging webhook found in ${channel}.` };
		}

		const guildWebhooks = await interaction.guild.fetchWebhooks().catch(() => null);

		if (guildWebhooks) {
			const discordWebhook = guildWebhooks.get(webhook.id);

			if (discordWebhook) {
				await discordWebhook.delete().catch(() => null);
			}
		}

		const updatedWebhooks = webhooks.filter(wh => wh.id !== webhook.id);
		const updatedConfig = { ...config.data, logging_webhooks: updatedWebhooks };

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully deleted the logging webhook in ${channel}.`
		};
	}

	private static async _listWebhooks(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const webhooks = config.data.logging_webhooks;

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
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const event = interaction.options.getString("event", true) as LoggingEvent;

		const webhooks = config.data.logging_webhooks;
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

		await addEvents(webhook.id, interaction.guildId, [event]);

		return {
			content: `Successfully added the event \`${formatEventName(event)}\` to the webhook in ${channel}.`
		};
	}

	private static async _removeEvent(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const event = interaction.options.getString("event", true) as LoggingEvent;

		const webhooks = config.data.logging_webhooks;
		const webhook = webhooks.find(wh => wh.channel_id === channel.id);

		if (!webhook) {
			return { error: `No logging webhook found in ${channel}.` };
		}

		if (!webhook.events.includes(event)) {
			return {
				error: `The event \`${formatEventName(event)}\` is not subscribed to for this webhook.`
			};
		}

		const updatedWebhook = await removeEvents(webhook.id, interaction.guildId, [event]);

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
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);

		const webhooks = config.data.logging_webhooks;
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
 * Adds events to an existing logging webhook.
 *
 * @param webhookId The ID of the webhook.
 * @param guildId The ID of the guild.
 * @param events The events to add.
 * @returns The updated LoggingWebhook record, or null if not found.
 */
async function addEvents(
	webhookId: string,
	guildId: string,
	events: LoggingEvent[]
): Promise<LoggingWebhook | null> {
	const config = await ConfigManager.get(guildId);
	const webhooks = config.data.logging_webhooks;
	const webhook = webhooks.find(wh => wh.id === webhookId);

	if (!webhook) return null;

	const uniqueEvents = [...new Set([...webhook.events, ...events])];
	const updatedWebhook = { ...webhook, events: uniqueEvents };
	const updatedWebhooks = webhooks.map(wh => (wh.id === webhookId ? updatedWebhook : wh));
	const updatedConfig = { ...config.data, logging_webhooks: updatedWebhooks };

	await kysely
		.updateTable("Guild")
		.set({ config: updatedConfig })
		.where("id", "=", guildId)
		.returningAll()
		.execute();

	return updatedWebhook;
}

/**
 * Removes events from an existing logging webhook.
 *
 * @param webhookId The ID of the webhook.
 * @param guildId The ID of the guild.
 * @param events The events to remove.
 * @returns The updated LoggingWebhook record, or null if not found.
 */
async function removeEvents(
	webhookId: string,
	guildId: string,
	events: LoggingEvent[]
): Promise<LoggingWebhook | null> {
	const config = await ConfigManager.get(guildId);
	const webhooks = config.data.logging_webhooks;
	const webhook = webhooks.find(wh => wh.id === webhookId);

	if (!webhook) return null;

	const updatedEvents = webhook.events.filter(e => !events.includes(e));
	const updatedWebhook = { ...webhook, events: updatedEvents };
	const updatedWebhooks = webhooks.map(wh => (wh.id === webhookId ? updatedWebhook : wh));
	const updatedConfig = { ...config.data, logging_webhooks: updatedWebhooks };

	await kysely
		.updateTable("Guild")
		.set({ config: updatedConfig })
		.where("id", "=", guildId)
		.returningAll()
		.execute();

	return updatedWebhook;
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
