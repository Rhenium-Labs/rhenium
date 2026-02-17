import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { RequestStatus, ReportStatus, Detector, DetectorMode, ContentFilterVerbosity, ContentFilterStatus, UserPermission, LoggingEvent } from "./Enums.js";

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
    duration: number | null;
    reason: string;
};
export type BanRequest = Selectable<BanRequestTable>;
export type NewBanRequest = Insertable<BanRequestTable>;
export type BanRequestUpdate = Updateable<BanRequestTable>;
export type BanRequestConfigTable = {
    id: string;
    enabled: Generated<boolean>;
    webhook_url: string | null;
    webhook_channel: string | null;
    automatically_timeout: Generated<boolean>;
    immune_roles: Generated<string[]>;
    notify_roles: Generated<string[]>;
    enforce_submission_reason: Generated<boolean>;
    enforce_deny_reason: Generated<boolean>;
};
export type BanRequestConfig = Selectable<BanRequestConfigTable>;
export type NewBanRequestConfig = Insertable<BanRequestConfigTable>;
export type BanRequestConfigUpdate = Updateable<BanRequestConfigTable>;
export type ContentFilterAlertTable = {
    id: string;
    guild_id: string;
    message_id: string;
    channel_id: string;
    alert_message_id: string;
    alert_channel_id: string;
    offender_id: string;
    detectors: Generated<Detector[]>;
    highest_score: Generated<number>;
    mod_status: Generated<ContentFilterStatus>;
    del_status: Generated<ContentFilterStatus>;
    created_at: Generated<Timestamp>;
};
export type ContentFilterAlert = Selectable<ContentFilterAlertTable>;
export type NewContentFilterAlert = Insertable<ContentFilterAlertTable>;
export type ContentFilterAlertUpdate = Updateable<ContentFilterAlertTable>;
export type ContentFilterChannelScopingTable = {
    guild_id: string;
    channel_id: string;
    /**
     * Include [`0`] or Exclude [`1`]
     */
    type: number;
};
export type ContentFilterChannelScoping = Selectable<ContentFilterChannelScopingTable>;
export type NewContentFilterChannelScoping = Insertable<ContentFilterChannelScopingTable>;
export type ContentFilterChannelScopingUpdate = Updateable<ContentFilterChannelScopingTable>;
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
export type NewContentFilterConfig = Insertable<ContentFilterConfigTable>;
export type ContentFilterConfigUpdate = Updateable<ContentFilterConfigTable>;
export type ContentFilterLogTable = {
    id: string;
    guild_id: string;
    alert_id: string;
    content: string;
    created_at: Generated<Timestamp>;
};
export type ContentFilterLog = Selectable<ContentFilterLogTable>;
export type NewContentFilterLog = Insertable<ContentFilterLogTable>;
export type ContentFilterLogUpdate = Updateable<ContentFilterLogTable>;
export type GuildTable = {
    id: string;
    config: Generated<unknown>;
};
export type Guild = Selectable<GuildTable>;
export type NewGuild = Insertable<GuildTable>;
export type GuildUpdate = Updateable<GuildTable>;
export type HighlightTable = {
    user_id: string;
    guild_id: string;
    patterns: Generated<string[]>;
    user_blacklist: Generated<string[]>;
};
export type Highlight = Selectable<HighlightTable>;
export type NewHighlight = Insertable<HighlightTable>;
export type HighlightUpdate = Updateable<HighlightTable>;
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
export type NewHighlightChannelScoping = Insertable<HighlightChannelScopingTable>;
export type HighlightChannelScopingUpdate = Updateable<HighlightChannelScopingTable>;
export type HighlightConfigTable = {
    id: string;
    enabled: Generated<boolean>;
    max_patterns: Generated<number>;
};
export type HighlightConfig = Selectable<HighlightConfigTable>;
export type NewHighlightConfig = Insertable<HighlightConfigTable>;
export type HighlightConfigUpdate = Updateable<HighlightConfigTable>;
export type LoggingWebhookTable = {
    id: string;
    url: string;
    token: string;
    channel_id: string;
    guild_id: string;
    events: Generated<LoggingEvent[]>;
};
export type LoggingWebhook = Selectable<LoggingWebhookTable>;
export type NewLoggingWebhook = Insertable<LoggingWebhookTable>;
export type LoggingWebhookUpdate = Updateable<LoggingWebhookTable>;
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
export type NewMessage = Insertable<MessageTable>;
export type MessageUpdate = Updateable<MessageTable>;
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
    additional_reporters: Generated<string[]>;
    status: Generated<ReportStatus>;
    resolved_at: Timestamp | null;
    resolved_by: string | null;
};
export type MessageReport = Selectable<MessageReportTable>;
export type NewMessageReport = Insertable<MessageReportTable>;
export type MessageReportUpdate = Updateable<MessageReportTable>;
export type MessageReportConfigTable = {
    id: string;
    enabled: Generated<boolean>;
    webhook_url: string | null;
    webhook_channel: string | null;
    auto_disregard_after: Generated<number>;
    delete_submission_on_handle: Generated<boolean>;
    immune_roles: Generated<string[]>;
    notify_roles: Generated<string[]>;
    blacklisted_users: Generated<string[]>;
    placeholder_reason: string | null;
    enforce_member_in_guild: Generated<boolean>;
    enforce_report_reason: Generated<boolean>;
};
export type MessageReportConfig = Selectable<MessageReportConfigTable>;
export type NewMessageReportConfig = Insertable<MessageReportConfigTable>;
export type MessageReportConfigUpdate = Updateable<MessageReportConfigTable>;
export type PermissionScopeTable = {
    guild_id: string;
    role_id: string;
    allowed_permissions: Generated<UserPermission[]>;
};
export type PermissionScope = Selectable<PermissionScopeTable>;
export type NewPermissionScope = Insertable<PermissionScopeTable>;
export type PermissionScopeUpdate = Updateable<PermissionScopeTable>;
export type QuickMuteTable = {
    user_id: string;
    guild_id: string;
    reaction: string;
    duration: number;
    reason: string;
    purge_amount: Generated<number>;
};
export type QuickMute = Selectable<QuickMuteTable>;
export type NewQuickMute = Insertable<QuickMuteTable>;
export type QuickMuteUpdate = Updateable<QuickMuteTable>;
export type QuickMuteChannelScopingTable = {
    guild_id: string;
    channel_id: string;
    /**
     * Include [`0`] or Exclude [`1`]
     */
    type: number;
};
export type QuickMuteChannelScoping = Selectable<QuickMuteChannelScopingTable>;
export type NewQuickMuteChannelScoping = Insertable<QuickMuteChannelScopingTable>;
export type QuickMuteChannelScopingUpdate = Updateable<QuickMuteChannelScopingTable>;
export type QuickMuteConfigTable = {
    id: string;
    enabled: Generated<boolean>;
    purge_limit: Generated<number>;
};
export type QuickMuteConfig = Selectable<QuickMuteConfigTable>;
export type NewQuickMuteConfig = Insertable<QuickMuteConfigTable>;
export type QuickMuteConfigUpdate = Updateable<QuickMuteConfigTable>;
export type QuickPurgeTable = {
    user_id: string;
    guild_id: string;
    reaction: string;
    purge_amount: number;
};
export type QuickPurge = Selectable<QuickPurgeTable>;
export type NewQuickPurge = Insertable<QuickPurgeTable>;
export type QuickPurgeUpdate = Updateable<QuickPurgeTable>;
export type QuickPurgeChannelScopingTable = {
    guild_id: string;
    channel_id: string;
    /**
     * Include [`0`] or Exclude [`1`]
     */
    type: number;
};
export type QuickPurgeChannelScoping = Selectable<QuickPurgeChannelScopingTable>;
export type NewQuickPurgeChannelScoping = Insertable<QuickPurgeChannelScopingTable>;
export type QuickPurgeChannelScopingUpdate = Updateable<QuickPurgeChannelScopingTable>;
export type QuickPurgeConfigTable = {
    id: string;
    enabled: Generated<boolean>;
    max_limit: Generated<number>;
};
export type QuickPurgeConfig = Selectable<QuickPurgeConfigTable>;
export type NewQuickPurgeConfig = Insertable<QuickPurgeConfigTable>;
export type QuickPurgeConfigUpdate = Updateable<QuickPurgeConfigTable>;
export type TemporaryBanTable = {
    guild_id: string;
    target_id: string;
    expires_at: Timestamp;
};
export type TemporaryBan = Selectable<TemporaryBanTable>;
export type NewTemporaryBan = Insertable<TemporaryBanTable>;
export type TemporaryBanUpdate = Updateable<TemporaryBanTable>;
export type WhitelistTable = {
    id: string;
    created_at: Generated<Timestamp>;
};
export type Whitelist = Selectable<WhitelistTable>;
export type NewWhitelist = Insertable<WhitelistTable>;
export type WhitelistUpdate = Updateable<WhitelistTable>;
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
    LoggingWebhook: LoggingWebhookTable;
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
};
