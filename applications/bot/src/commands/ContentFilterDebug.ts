import { Colors, EmbedBuilder, codeBlock, time } from "discord.js";

import { hastebin, inflect } from "#utils/index.js";
import { CommandCategory } from "#commands/Command.js";

import type { CommandExecutionContext, ResponseData } from "#commands/Command.js";

import Command from "#commands/Command.js";
import GlobalConfig from "#config/GlobalConfig.js";
import AutomatedScanner from "#managers/cf/AutomatedScanner.js";
import HeuristicScanner from "#managers/cf/HeuristicScanner.js";
import { client } from "#root/index.js";

export default class ContentFilterDebug extends Command {
	constructor() {
		super({
			name: "content-filter-debug",
			aliases: ["cfd", "cfstate", "cfstats"],
			category: CommandCategory.Developer,
			description: "Inspect beta content filter internal state."
		});
	}

	override async executeMessage({
		message,
		args
	}: CommandExecutionContext<"message">): Promise<ResponseData<"message"> | null> {
		if (!GlobalConfig.isDeveloper(message.author.id)) {
			return null;
		}

		const subcommand = (args.getString() ?? "overview").toLowerCase();

		switch (subcommand) {
			case "overview":
			case "summary":
				return ContentFilterDebug._overview(message.guild.id);
			case "channel": {
				const channelId = args.getString() ?? message.channel.id;
				return ContentFilterDebug._channel(channelId);
			}
			case "queue":
				return ContentFilterDebug._queue(message.guild.id);
			case "dead": {
				const limit = Number.parseInt(args.getString() ?? "10", 10);
				return ContentFilterDebug._deadLetters(Number.isFinite(limit) ? limit : 10);
			}
			default:
				return {
					error: `Unknown subcommand \`${subcommand}\`. Available subcommands are: \`overview\`, \`channel\`, \`queue\`, \`dead\`.`
				};
		}
	}

	/**
	 * Builds a high-level snapshot of current scanner state.
	 *
	 * @param guildId The guild identifier used to scope diagnostics.
	 * @returns A message response containing queue, state, and dead-letter summaries.
	 */
	private static async _overview(guildId: string): Promise<ResponseData<"message">> {
		const diagnostics = AutomatedScanner.getDiagnostics({ guildId });
		const heuristic = HeuristicScanner.getDiagnostics();
		const states = diagnostics.states.slice(0, 6);

		const stateLines =
			states.length > 0
				? states
						.map((state, i) => {
							const channel = client.channels.cache.get(state.channelId);
							const channelName = channel
								? `${channel} (\`${channel.id}\`)`
								: `\`#${state.channelId}\``;

							return `${i + 1}. ${channelName} - ${state.queueDepth} queued, ${state.scanRate} MPM scan rate, ${state.ewmaMpm.toFixed(1)} EWMA, ${state.falsePositiveRatio.toFixed(2)} false positive ratio.`;
						})
						.join("\n")
				: "No tracked channels yet.";

		const embed = new EmbedBuilder()
			.setAuthor({
				name: "Content Filter Diagnostics",
				iconURL: client.user.displayAvatarURL()
			})
			.setColor(Colors.NotQuiteBlack)
			.setFields(
				{
					name: "Queue",
					value: `${diagnostics.queue.total} total (${diagnostics.queue.newJobs} new, ${diagnostics.queue.retryJobs} ${inflect(diagnostics.queue.retryJobs, "retry job")})${diagnostics.queue.nextScheduledAt ? `, next ${time(new Date(diagnostics.queue.nextScheduledAt), "R")}` : ""}`,
					inline: true
				},
				{
					name: "Dead Letters",
					value: `${diagnostics.deadLetters.totalRecorded} total (${diagnostics.deadLetters.buffered} buffered)`,
					inline: true
				},
				{
					name: "Heuristic Timers",
					value: `${heuristic.timers} ${inflect(heuristic.timers, "timer")} (${heuristic.trackedChannels} tracked channels)`,
					inline: true
				},
				{
					name: "Most Active Channels",
					value:
						stateLines.length > 1024
							? stateLines.slice(0, 1021) + "..."
							: stateLines
				}
			)
			.setTimestamp();

		return { embeds: [embed] };
	}

	/**
	 * Builds a single-channel diagnostics snapshot.
	 *
	 * @param channelId The channel identifier whose state should be displayed.
	 * @returns A message response containing channel-level heuristic metrics.
	 */
	private static async _channel(channelId: string): Promise<ResponseData<"message">> {
		const diagnostics = AutomatedScanner.getDiagnostics({ channelId });
		const state = diagnostics.states[0];

		if (!state)
			return {
				content: `No state information available for channel with ID \`${channelId}\`.`
			};

		const embed = new EmbedBuilder()
			.setAuthor({
				name: `Content Filter Channel Snapshot - ${state.channelId}`,
				iconURL: client.user.displayAvatarURL()
			})
			.setColor(Colors.NotQuiteBlack)
			.setFields(
				{ name: "Queue Depth", value: String(state.queueDepth), inline: true },
				{ name: "Scan Rate", value: `${state.scanRate} / min`, inline: true },
				{ name: "EWMA MPM", value: state.ewmaMpm.toFixed(2), inline: true },
				{
					name: "False Positive Ratio",
					value: state.falsePositiveRatio.toFixed(3),
					inline: true
				},
				{
					name: "Tracked Users",
					value: `${state.trackedUsers} ${inflect(state.trackedUsers, "user")} (${state.priorityUsers} priority)`,
					inline: true
				},
				{
					name: "Last Activity",
					value: `<t:${Math.floor(state.lastActivity / 1000)}:R>`,
					inline: true
				}
			)
			.setTimestamp();

		return { embeds: [embed] };
	}

	/**
	 * Builds a queue-only diagnostics snapshot.
	 *
	 * @param guildId The guild identifier used to scope diagnostics.
	 * @returns A message response with queue counters and scheduling details.
	 */
	private static async _queue(guildId: string): Promise<ResponseData<"message">> {
		const diagnostics = AutomatedScanner.getDiagnostics({ guildId });
		const queue = diagnostics.queue;

		const lines = [
			`Total: ${queue.total}`,
			`New: ${queue.newJobs}`,
			`Retry: ${queue.retryJobs}`,
			`Next Scheduled: ${queue.nextScheduledAt ?? "none"}`,
			`Oldest Enqueued: ${queue.oldestEnqueuedAt ?? "none"}`
		].join("\n");

		return {
			embeds: [
				new EmbedBuilder()
					.setAuthor({
						name: `Content Filter Queue Snapshot`,
						iconURL: client.user.displayAvatarURL()
					})
					.setColor(Colors.NotQuiteBlack)
					.setDescription(codeBlock("ini", lines))
					.setTimestamp()
			]
		};
	}

	/**
	 * Builds a dead-letter diagnostics view.
	 *
	 * @param limit Maximum number of entries to display.
	 * @returns A message response containing dead-letter entries or a hastebin link.
	 */
	private static async _deadLetters(limit: number): Promise<ResponseData<"message">> {
		const diagnostics = AutomatedScanner.getDiagnostics();
		const entries = diagnostics.recentDeadLetters.slice(0, Math.max(1, limit));

		if (entries.length === 0)
			return {
				content: "Found no dead-letter entries recorded in memory.",
				temporary: true
			};

		const body = entries
			.map(
				entry =>
					`${new Date(entry.createdAt).toISOString()} | ${entry.reason} | Source: ${entry.job.source}\nMessage: ${entry.job.messageId}\nAttempts: ${entry.job.attempts}/${entry.job.maxAttempts}`
			)
			.join("\n");

		if (body.length <= 900) {
			return {
				embeds: [
					new EmbedBuilder()
						.setAuthor({
							name: `Content Filter Dead Letters (\`${entries.length}\`/\`${diagnostics.deadLetters.totalRecorded}\`)`,
							iconURL: client.user.displayAvatarURL()
						})
						.setColor(Colors.NotQuiteBlack)
						.setDescription(codeBlock("txt", body))
						.setTimestamp()
				]
			};
		}

		const url = await hastebin(body, "txt");

		return {
			embeds: [
				new EmbedBuilder()
					.setColor(Colors.NotQuiteBlack)
					.setAuthor({
						name: "Content Filter Dead Letters",
						iconURL: client.user.displayAvatarURL()
					})
					.setDescription(
						url
							? `[Open full dead-letter dump](${url})`
							: "Dead-letter dump was too long to inline."
					)
					.setTimestamp()
			]
		};
	}
}
