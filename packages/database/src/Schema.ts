import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { RequestStatus, ReportStatus, Detector, ContentFilterStatus } from "./Enums.js";

export type AuthSessionTable = {
	user_id: string;
	session_id: Generated<string>;
	access_token: string;
	refresh_token: string;
	expires_at: Timestamp;
	updated_at: Generated<Timestamp>;
	username: string | null;
	global_name: string | null;
	avatar: string | null;
};
export type AuthSession = Selectable<AuthSessionTable>;
export type NewAuthSession = Insertable<AuthSessionTable>;
export type AuthSessionUpdate = Updateable<AuthSessionTable>;
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
    expires_at: Timestamp | null;
    reason: string;
};
export type BanRequest = Selectable<BanRequestTable>;
export type NewBanRequest = Insertable<BanRequestTable>;
export type BanRequestUpdate = Updateable<BanRequestTable>;
export type ChannelCacheTable = {
    guild_id: string;
    channel_id: string;
    name: string;
    updated_at: Generated<Timestamp>;
};
export type ChannelCache = Selectable<ChannelCacheTable>;
export type NewChannelCache = Insertable<ChannelCacheTable>;
export type ChannelCacheUpdate = Updateable<ChannelCacheTable>;
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
    config: unknown;
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
export type QuickMuteTable = {
    user_id: string;
    guild_id: string;
    reaction: string;
    duration: string;
    reason: string;
    purge_amount: Generated<number>;
};
export type QuickMute = Selectable<QuickMuteTable>;
export type NewQuickMute = Insertable<QuickMuteTable>;
export type QuickMuteUpdate = Updateable<QuickMuteTable>;
export type QuickPurgeTable = {
    user_id: string;
    guild_id: string;
    reaction: string;
    purge_amount: number;
};
export type QuickPurge = Selectable<QuickPurgeTable>;
export type NewQuickPurge = Insertable<QuickPurgeTable>;
export type QuickPurgeUpdate = Updateable<QuickPurgeTable>;
export type RoleCacheTable = {
    guild_id: string;
    role_id: string;
    name: string;
    color: Generated<number>;
    updated_at: Generated<Timestamp>;
};
export type RoleCache = Selectable<RoleCacheTable>;
export type NewRoleCache = Insertable<RoleCacheTable>;
export type RoleCacheUpdate = Updateable<RoleCacheTable>;
export type SessionTable = {
    user_id: string;
    access_token: string;
    refresh_token: string;
    expires_at: Timestamp;
    updated_at: Generated<Timestamp>;
};
export type Session = Selectable<SessionTable>;
export type NewSession = Insertable<SessionTable>;
export type SessionUpdate = Updateable<SessionTable>;
export type TemporaryBanTable = {
    guild_id: string;
    target_id: string;
    expires_at: Timestamp;
};
export type TemporaryBan = Selectable<TemporaryBanTable>;
export type NewTemporaryBan = Insertable<TemporaryBanTable>;
export type TemporaryBanUpdate = Updateable<TemporaryBanTable>;
export type UserGuildCacheTable = {
    user_id: string;
    guild_id: string;
    name: string;
    icon: string | null;
    permissions: string;
    bot_in_guild: Generated<boolean>;
    cached_at: Generated<Timestamp>;
};
export type UserGuildCache = Selectable<UserGuildCacheTable>;
export type NewUserGuildCache = Insertable<UserGuildCacheTable>;
export type UserGuildCacheUpdate = Updateable<UserGuildCacheTable>;
export type WhitelistTable = {
    id: string;
    created_at: Generated<Timestamp>;
};
export type Whitelist = Selectable<WhitelistTable>;
export type NewWhitelist = Insertable<WhitelistTable>;
export type WhitelistUpdate = Updateable<WhitelistTable>;
export type DB = {
    BanRequest: BanRequestTable;
    ContentFilterAlert: ContentFilterAlertTable;
    ContentFilterLog: ContentFilterLogTable;
    "dashboard.ChannelCache": ChannelCacheTable;
    "dashboard.RoleCache": RoleCacheTable;
    "dashboard.Session": SessionTable;
    "dashboard.UserGuildCache": UserGuildCacheTable;
    Guild: GuildTable;
    Highlight: HighlightTable;
    HighlightChannelScoping: HighlightChannelScopingTable;
    Message: MessageTable;
    MessageReport: MessageReportTable;
    QuickMute: QuickMuteTable;
    QuickPurge: QuickPurgeTable;
    TemporaryBan: TemporaryBanTable;
    Whitelist: WhitelistTable;
};
