import { Detector } from "@repo/db/enums";
import { z } from "zod";

export { Detector };

export enum UserPermission {
	ReviewMessageReports = "ReviewMessageReports",
	ReviewBanRequests = "ReviewBanRequests",
	UseHighlights = "UseHighlights",
	UseQuickMute = "UseQuickMute",
	UseQuickPurge = "UseQuickPurge"
}

export const PERMISSION_SCOPE_SCHEMA = z.object({
	role_id: z.string().nonempty(),
	allowed_permissions: z.array(z.enum(UserPermission)).default([])
});

export type PermissionScope = z.infer<typeof PERMISSION_SCOPE_SCHEMA>;

export enum LoggingEvent {
	MessageReportReviewed = "MessageReportReviewed",
	BanRequestReviewed = "BanRequestReviewed",
	BanRequestResult = "BanRequestResult",
	QuickPurgeResult = "QuickPurgeResult",
	QuickPurgeExecuted = "QuickPurgeExecuted",
	QuickMuteResult = "QuickMuteResult",
	QuickMuteExecuted = "QuickMuteExecuted"
}

export const LOGGING_WEBHOOK_SCHEMA = z.object({
	id: z.string().nonempty(),
	url: z.string().nonempty(),
	token: z.string().nonempty(),
	channel_id: z.string().nonempty(),
	events: z.array(z.enum(LoggingEvent)).default([])
});

export type LoggingWebhook = z.infer<typeof LOGGING_WEBHOOK_SCHEMA>;

export enum ChannelScopingType {
	/** Actions can only be used in these channels. */
	Include = 0,
	/** Actions can only be used outside of these channels. */
	Exclude = 1
}

export const CHANNEL_SCOPING_SCHEMA = z.object({
	channel_id: z.string().nonempty(),
	type: z.enum(ChannelScopingType)
});

export type RawChannelScoping = z.infer<typeof CHANNEL_SCOPING_SCHEMA>;
export type ParsedChannelScoping = {
	included_channels: string[];
	excluded_channels: string[];
};

export const MESSAGE_REPORT_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	webhook_url: z.string().nullable().optional(),
	webhook_channel: z.string().nullable().optional(),

	auto_disregard_after: z.string().default("0"),
	delete_submission_on_handle: z.boolean().default(true),

	immune_roles: z.array(z.string()).default([]),
	notify_roles: z.array(z.string()).default([]),
	blacklisted_users: z.array(z.string()).default([]),
	placeholder_reason: z.string().max(1024).nullable(),

	enforce_member_in_guild: z.boolean().default(true),
	enforce_report_reason: z.boolean().default(true)
});

export type MessageReportConfig = z.infer<typeof MESSAGE_REPORT_CONFIG_SCHEMA>;

export const BAN_REQUEST_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	webhook_url: z.string().nullable().optional(),
	webhook_channel: z.string().nullable().optional(),

	automatically_timeout: z.boolean().default(false),
	enforce_submission_reason: z.boolean().default(true),
	enforce_deny_reason: z.boolean().default(true),

	immune_roles: z.array(z.string()).default([]),
	notify_roles: z.array(z.string()).default([]),

	notify_target: z.boolean().default(true),
	disable_reason_field: z.boolean().default(false),
	additional_info: z.string().nullable().default(null),
	delete_message_seconds: z.number().nullable().default(null)
});

export type BanRequestConfig = z.infer<typeof BAN_REQUEST_CONFIG_SCHEMA>;

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

export const CONTENT_FILTER_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	webhook_url: z.string().nullable().optional(),
	use_native_automod: z.boolean().default(false),

	detectors: z.array(z.enum(Detector)).default([]),
	detector_mode: z.enum(DetectorMode).default(DetectorMode.Medium),
	verbosity: z.enum(ContentFilterVerbosity).default(ContentFilterVerbosity.Medium),

	immune_roles: z.array(z.string()).default([]),
	notify_roles: z.array(z.string()).default([]),

	channel_scoping: z.array(CHANNEL_SCOPING_SCHEMA).default([]),

	ocr_filter_keywords: z.array(z.string()).default([]),
	ocr_filter_regex: z.array(z.string()).default([])
});

export type ContentFilterConfig = z.infer<typeof CONTENT_FILTER_CONFIG_SCHEMA>;

export const HIGHLIGHT_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	max_patterns: z.number().min(1).max(30).default(15)
});

export type HighlightConfig = z.infer<typeof HIGHLIGHT_CONFIG_SCHEMA>;

export const QUICK_MUTE_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	purge_limit: z.number().min(2).max(500).default(100),
	channel_scoping: z.array(CHANNEL_SCOPING_SCHEMA).default([])
});

export type QuickMuteConfig = z.infer<typeof QUICK_MUTE_CONFIG_SCHEMA>;

export const QUICK_PURGE_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(true),
	max_limit: z.number().min(2).max(500).default(100),
	channel_scoping: z.array(CHANNEL_SCOPING_SCHEMA).default([])
});

export type QuickPurgeConfig = z.infer<typeof QUICK_PURGE_CONFIG_SCHEMA>;

export const GUILD_CONFIG_SCHEMA = z.object({
	message_reports: MESSAGE_REPORT_CONFIG_SCHEMA,
	ban_requests: BAN_REQUEST_CONFIG_SCHEMA,
	content_filter: CONTENT_FILTER_CONFIG_SCHEMA,
	highlights: HIGHLIGHT_CONFIG_SCHEMA,
	quick_mutes: QUICK_MUTE_CONFIG_SCHEMA,
	quick_purges: QUICK_PURGE_CONFIG_SCHEMA,
	logging_webhooks: z.array(LOGGING_WEBHOOK_SCHEMA).default([]),
	permission_scopes: z.array(PERMISSION_SCOPE_SCHEMA).default([])
});

export type RawGuildConfig = z.infer<typeof GUILD_CONFIG_SCHEMA>;

/** Default configuration for a guild. */
export const DEFAULT_GUILD_CONFIG: RawGuildConfig = {
	message_reports: {
		enabled: true,
		webhook_url: null,
		webhook_channel: null,

		auto_disregard_after: "0",
		delete_submission_on_handle: true,

		immune_roles: [],
		notify_roles: [],
		blacklisted_users: [],
		placeholder_reason: null,
		enforce_member_in_guild: true,
		enforce_report_reason: true
	},
	ban_requests: {
		enabled: true,
		webhook_url: null,
		webhook_channel: null,
		automatically_timeout: false,
		enforce_submission_reason: true,
		enforce_deny_reason: true,
		immune_roles: [],
		notify_roles: [],
		notify_target: true,
		disable_reason_field: false,
		additional_info: null,
		delete_message_seconds: null
	},
	content_filter: {
		enabled: true,
		webhook_url: null,
		use_native_automod: false,

		detectors: [],
		detector_mode: DetectorMode.Medium,
		verbosity: ContentFilterVerbosity.Medium,
		immune_roles: [],
		notify_roles: [],
		channel_scoping: [],
		ocr_filter_keywords: [],
		ocr_filter_regex: []
	},
	highlights: {
		enabled: true,
		max_patterns: 15
	},
	quick_mutes: {
		enabled: true,
		purge_limit: 100,
		channel_scoping: []
	},
	quick_purges: {
		enabled: true,
		max_limit: 100,
		channel_scoping: []
	},
	logging_webhooks: [],
	permission_scopes: []
};
