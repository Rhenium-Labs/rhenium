import { z } from "zod";

/** Zod regex schema for validating cron expressions. */
// Format: "*/5 * * * *" (every 5 minutes)
const zodCronRegex = z
	.string()
	.regex(
		/^(@(annually|yearly|monthly|weekly|daily|hourly|reboot))|(@every (\d+(ns|us|µs|ms|s|m|h))+)|((((\d+,)+\d+|([\d*]+[/-]\d+)|\d+|\*) ?){5,7})$/gm
	);

// ————————————————————————————————————————————————————————————————————————————————
// Global Config
// ————————————————————————————————————————————————————————————————————————————————

export const GLOBAL_CONFIG_SCHEMA = z.object({
	developers: z.array(z.string()).default([]),
	database: z.object({
		messages: z.object({
			insert_cron: zodCronRegex,
			delete_cron: zodCronRegex,
			ttl: z.number().min(1000).default(604800000) // 7 days in milliseconds
		}),
		reports: z.object({
			disregard_cron: zodCronRegex
		})
	})
});

export type GlobalConfig = z.infer<typeof GLOBAL_CONFIG_SCHEMA>;

// ————————————————————————————————————————————————————————————————————————————————
// Guild Config
// ————————————————————————————————————————————————————————————————————————————————

export enum UserPermission {
	ReviewMessageReports = "ReviewMessageReports",
	ReviewBanRequests = "ReviewBanRequests",
	UseHighlights = "UseHighlights",
	UseQuickMute = "UseQuickMute",
	UseQuickPurge = "UseQuickPurge"
}

const permissionScopeSchema = z.object({
	role_id: z.string().nonempty(),
	allowed_permissions: z.array(z.enum(UserPermission)).default([])
});

export type PermissionScope = z.infer<typeof permissionScopeSchema>;

export enum LoggingEvent {
	MessageReportReviewed = "MessageReportReviewed",
	BanRequestReviewed = "BanRequestReviewed",
	BanRequestResult = "BanRequestResult",
	QuickPurgeResult = "QuickPurgeResult",
	QuickPurgeExecuted = "QuickPurgeExecuted",
	QuickMuteResult = "QuickMuteResult",
	QuickMuteExecuted = "QuickMuteExecuted"
}

const loggingWebhookSchema = z.object({
	id: z.string().nonempty(),
	url: z.string().nonempty(),
	token: z.string().nonempty(),
	channel_id: z.string().nonempty(),
	events: z.array(z.enum(LoggingEvent)).default([])
});

export type LoggingWebhook = z.infer<typeof loggingWebhookSchema>;

export enum ChannelScopingType {
	/** Actions can only be used in these channels. */
	Include = 0,
	/** Actions can only be used outside of these channels. */
	Exclude = 1
}

const channelScopingSchema = z.object({
	channel_id: z.string().nonempty(),
	type: z.enum(ChannelScopingType)
});

export type RawChannelScoping = z.infer<typeof channelScopingSchema>;
export type ParsedChannelScoping = {
	included_channels: string[];
	excluded_channels: string[];
};

const messageReportConfigSchema = z.object({
	enabled: z.boolean().default(true),
	webhook_url: z.string().nullable().optional(),
	webhook_channel: z.string().nullable().optional(),

	auto_disregard_after: z.string().default("0"),
	delete_submission_on_handle: z.boolean().default(true),

	immune_roles: z.array(z.string()).default([]),
	notify_roles: z.array(z.string()).default([]),
	blacklisted_users: z.array(z.string()).default([]),
	placeholder_reason: z.string().nullable(),

	enforce_member_in_guild: z.boolean().default(true),
	enforce_report_reason: z.boolean().default(true)
});

export type MessageReportConfig = z.infer<typeof messageReportConfigSchema>;

const banRequestConfigSchema = z.object({
	enabled: z.boolean().default(true),
	webhook_url: z.string().nullable().optional(),
	webhook_channel: z.string().nullable().optional(),

	automatically_timeout: z.boolean().default(false),
	enforce_submission_reason: z.boolean().default(true),
	enforce_deny_reason: z.boolean().default(true),

	immune_roles: z.array(z.string()).default([]),
	notify_roles: z.array(z.string()).default([])
});

export type BanRequestConfig = z.infer<typeof banRequestConfigSchema>;

export enum Detector {
	NSFW = "NSFW",
	OCR = "OCR",
	TEXT = "TEXT"
}

export enum DetectorMode {
	Lenient = "Lenient",
	Medium = "Medium",
	Strict = "Strict"
}

export enum ContentFilterVerbosity {
	Minimal = "Minimal",
	Medium = "Medium",
	Verbose = "Verbose"
}

const contentFilterConfigSchema = z.object({
	enabled: z.boolean().default(true),
	webhook_url: z.string().nullable().optional(),
	use_native_automod: z.boolean().default(false),

	detectors: z.array(z.enum(Detector)).default([]),
	detector_mode: z.enum(DetectorMode).default(DetectorMode.Medium),
	verbosity: z.enum(ContentFilterVerbosity).default(ContentFilterVerbosity.Medium),

	immune_roles: z.array(z.string()).default([]),
	notify_roles: z.array(z.string()).default([]),

	channel_scoping: z.array(channelScopingSchema).default([]),

	ocr_filter_keywords: z.array(z.string()).default([]),
	ocr_filter_regex: z.array(z.string()).default([])
});

export type ContentFilterConfig = z.infer<typeof contentFilterConfigSchema>;

const highlightConfigSchema = z.object({
	enabled: z.boolean().default(true),
	max_patterns: z.number().min(1).max(30).default(15)
});

export type HighlightConfig = z.infer<typeof highlightConfigSchema>;

const quickMuteConfigSchema = z.object({
	enabled: z.boolean().default(true),
	purge_limit: z.number().min(2).max(500).default(100),
	channel_scoping: z.array(channelScopingSchema).default([])
});

export type QuickMuteConfig = z.infer<typeof quickMuteConfigSchema>;

const quickPurgeConfigSchema = z.object({
	enabled: z.boolean().default(true),
	max_limit: z.number().min(2).max(500).default(100),
	channel_scoping: z.array(channelScopingSchema).default([])
});

export type QuickPurgeConfig = z.infer<typeof quickPurgeConfigSchema>;

export const GUILD_CONFIG_SCHEMA = z.object({
	message_reports: messageReportConfigSchema,
	ban_requests: banRequestConfigSchema,
	content_filter: contentFilterConfigSchema,
	highlights: highlightConfigSchema,
	quick_mutes: quickMuteConfigSchema,
	quick_purges: quickPurgeConfigSchema,
	logging_webhooks: z.array(loggingWebhookSchema).default([]),
	permission_scopes: z.array(permissionScopeSchema).default([])
});

export type RawGuildConfig = z.infer<typeof GUILD_CONFIG_SCHEMA>;
