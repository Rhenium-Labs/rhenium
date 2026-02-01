import type { ColumnType, Selectable } from "kysely";
export type Generated<T> =
	T extends ColumnType<infer S, infer I, infer U>
		? ColumnType<S, I | undefined, U>
		: ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import {
	type RequestStatus,
	type ReportStatus,
	type Detector,
	type DetectorMode,
	type ContentFilterVerbosity,
	type ContentFilterStatus,
	type UserPermission,
	type LoggingEvent
} from "./Enums.js";

export type BanRequestTable = {
	id: string;
	guild_id: string;
	target_id: string;
	target_muted_automatically: Generated<boolean>;
	status: Generated<RequestStatus>;
	resolved_at: Timestamp | null;
	resolved_by: string | null;
	requested_at: Generated<Timestamp>;
	requested_by: string;
	duration: bigint | null;
	reason: string;
};

export type BanRequest = Selectable<BanRequestTable>;

export type BanRequestConfigTable = {
	id: string;
	enabled: Generated<boolean>;
	webhook_url: string | null;
	log_webhook_url: string | null;
	decision_webhook_url: string | null;
	automatically_timeout: Generated<boolean>;
	immune_roles: Generated<string[]>;
	notify_roles: Generated<string[]>;
	enforce_submission_reason: Generated<boolean>;
	enforce_accept_reason: Generated<boolean>;
	enforce_deny_reason: Generated<boolean>;
};
export type BanRequestConfig = Selectable<BanRequestConfigTable>;

export type ContentFilterAlertTable = {
	id: string;
	guild_id: string;
	message_id: string;
	channel_id: string;
	alert_message_id: string;
	alert_channel_id: string;
	offender_id: string;
	detectors: Detector[];
	highest_score: Generated<number>;
	mod_status: Generated<ContentFilterStatus>;
	del_status: Generated<ContentFilterStatus>;
	created_at: Generated<Timestamp>;
};
export type ContentFilterAlert = Selectable<ContentFilterAlertTable>;

export type ContentFilterChannelScopingTable = {
	guild_id: string;
	channel_id: string;
	/**
	 * Include [`0`] or Exclude [`1`]
	 */
	type: number;
};
export type ContentFilterChannelScoping = Selectable<ContentFilterChannelScopingTable>;

export type ContentFilterConfigTable = {
	id: string;
	enabled: Generated<boolean>;
	use_native_automod: Generated<boolean>;
	webhook_url: string | null;
	detectors: Generated<Detector[]>;
	detector_mode: Generated<DetectorMode>;
	verbosity: Generated<ContentFilterVerbosity>;
	immune_roles: Generated<string[]>;
	notify_roles: Generated<string[]>;
	ocr_filter_keywords: Generated<string[]>;
	ocr_filter_regex: Generated<string[]>;
};
export type ContentFilterConfig = Selectable<ContentFilterConfigTable>;

export type ContentFilterLogTable = {
	id: string;
	guild_id: string;
	alert_id: string;
	content: string;
	created_at: Generated<Timestamp>;
};
export type ContentFilterLog = Selectable<ContentFilterLogTable>;

export type GuildTable = {
	id: string;
};

export type HighlightTable = {
	user_id: string;
	guild_id: string;
	patterns: string[];
	user_blacklist: string[];
};
export type Highlight = Selectable<HighlightTable>;

export type HighlightChannelScopingTable = {
	user_id: string;
	guild_id: string;
	channel_id: string;
	/**
	 * Include [`0`] or Exclude [`1`]
	 */
	type: number;
};
export type HighlightChannelScoping = Selectable<HighlightChannelScopingTable>;

export type HighlightConfigTable = {
	id: string;
	enabled: Generated<boolean>;
	max_patterns: Generated<number>;
};
export type HighlightConfig = Selectable<HighlightConfigTable>;

export type MessageTable = {
	id: string;
	guild_id: string;
	author_id: string;
	channel_id: string;
	sticker_id: string | null;
	reference_id: string | null;
	created_at: Timestamp;
	content: string | null;
	attachments: string[];
	deleted: Generated<boolean>;
};
export type Message = Selectable<MessageTable>;

export type MessageReportTable = {
	id: string;
	guild_id: string;
	message_id: string;
	reference_id: string | null;
	message_url: string;
	channel_id: string;
	author_id: string;
	content: string | null;
	reported_at: Timestamp;
	reported_by: string;
	report_reason: string;
	status: Generated<ReportStatus>;
	resolved_at: Timestamp | null;
	resolved_by: string | null;
};
export type MessageReport = Selectable<MessageReportTable>;

export type MessageReportConfigTable = {
	id: string;
	enabled: Generated<boolean>;
	webhook_url: string | null;
	log_webhook_url: string | null;
	auto_disregard_after: Generated<bigint>;
	immune_roles: Generated<string[]>;
	notify_roles: Generated<string[]>;
	blacklisted_users: Generated<string[]>;
	placeholder_reason: string | null;
	enforce_member_in_guild: Generated<boolean>;
	enforce_report_reason: Generated<boolean>;
};
export type MessageReportConfig = Selectable<MessageReportConfigTable>;

export type PermissionScopeTable = {
	guild_id: string;
	role_id: string;
	allowed_permissions: UserPermission[];
};
export type PermissionScope = Selectable<PermissionScopeTable>;

export type QuickMuteTable = {
	user_id: string;
	guild_id: string;
	reaction: string;
	duration: bigint;
	reason: string;
	purge_amount: Generated<number>;
};
export type QuickMute = Selectable<QuickMuteTable>;

export type QuickMuteChannelScopingTable = {
	guild_id: string;
	channel_id: string;
	/**
	 * Include [`0`] or Exclude [`1`]
	 */
	type: number;
};
export type QuickMuteChannelScoping = Selectable<QuickMuteChannelScopingTable>;

export type QuickMuteConfigTable = {
	id: string;
	enabled: Generated<boolean>;
	purge_limit: Generated<number>;
	webhook_url: string | null;
	result_webhook_url: string | null;
};
export type QuickMuteConfig = Selectable<QuickMuteConfigTable>;

export type QuickPurgeTable = {
	user_id: string;
	guild_id: string;
	reaction: string;
	purge_amount: number;
};
export type QuickPurge = Selectable<QuickPurgeTable>;

export type QuickPurgeChannelScopingTable = {
	guild_id: string;
	channel_id: string;
	/**
	 * Include [`0`] or Exclude [`1`]
	 */
	type: number;
};
export type QuickPurgeChannelScoping = Selectable<QuickPurgeChannelScopingTable>;

export type QuickPurgeConfigTable = {
	id: string;
	enabled: Generated<boolean>;
	max_limit: Generated<number>;
	webhook_url: string | null;
	result_webhook_url: string | null;
};
export type QuickPurgeConfig = Selectable<QuickPurgeConfigTable>;

export type TemporaryBanTable = {
	guild_id: string;
	target_id: string;
	expires_at: Timestamp;
};
export type TemporaryBan = Selectable<TemporaryBanTable>;

export type WhitelistTable = {
	id: string;
	created_at: Generated<Timestamp>;
};
export type Whitelist = Selectable<WhitelistTable>;

export type LoggingWebhookTable = {
	id: string;
	url: string;
	token: string;
	channel_id: string;
	guild_id: string;
	events: Generated<LoggingEvent[]>;
};

export type LoggingWebhook = Selectable<LoggingWebhookTable>;

export type DB = {
	BanRequest: BanRequestTable;
	BanRequestConfig: BanRequestConfigTable;
	ContentFilterAlert: ContentFilterAlertTable;
	ContentFilterChannelScoping: ContentFilterChannelScopingTable;
	ContentFilterConfig: ContentFilterConfigTable;
	ContentFilterLog: ContentFilterLogTable;
	Guild: GuildTable;
	Highlight: HighlightTable;
	HighlightChannelScoping: HighlightChannelScopingTable;
	HighlightConfig: HighlightConfigTable;
	Message: MessageTable;
	MessageReport: MessageReportTable;
	MessageReportConfig: MessageReportConfigTable;
	PermissionScope: PermissionScopeTable;
	QuickMute: QuickMuteTable;
	QuickMuteChannelScoping: QuickMuteChannelScopingTable;
	QuickMuteConfig: QuickMuteConfigTable;
	QuickPurge: QuickPurgeTable;
	QuickPurgeChannelScoping: QuickPurgeChannelScopingTable;
	QuickPurgeConfig: QuickPurgeConfigTable;
	TemporaryBan: TemporaryBanTable;
	Whitelist: WhitelistTable;
	LoggingWebhook: LoggingWebhookTable;
};
