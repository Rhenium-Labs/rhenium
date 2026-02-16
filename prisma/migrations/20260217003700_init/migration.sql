-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('AutoResolved', 'Pending', 'Disregarded', 'Accepted', 'Denied');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('AutoResolved', 'Pending', 'Disregarded', 'Resolved');

-- CreateEnum
CREATE TYPE "Detector" AS ENUM ('NSFW', 'OCR', 'TEXT');

-- CreateEnum
CREATE TYPE "DetectorMode" AS ENUM ('Lenient', 'Medium', 'Strict');

-- CreateEnum
CREATE TYPE "ContentFilterVerbosity" AS ENUM ('Minimal', 'Medium', 'Verbose');

-- CreateEnum
CREATE TYPE "ContentFilterStatus" AS ENUM ('Pending', 'Resolved', 'False', 'Deleted');

-- CreateEnum
CREATE TYPE "UserPermission" AS ENUM ('ReviewMessageReports', 'ReviewBanRequests', 'UseHighlights', 'UseQuickMute', 'UseQuickPurge');

-- CreateEnum
CREATE TYPE "LoggingEvent" AS ENUM ('MessageReportReviewed', 'BanRequestReviewed', 'BanRequestResult', 'QuickPurgeResult', 'QuickPurgeExecuted', 'QuickMuteResult', 'QuickMuteExecuted');

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Whitelist" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReportConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "webhook_channel" TEXT,
    "auto_disregard_after" BIGINT NOT NULL DEFAULT 0,
    "delete_submission_on_handle" BOOLEAN NOT NULL DEFAULT true,
    "immune_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notify_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blacklisted_users" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "placeholder_reason" TEXT,
    "enforce_member_in_guild" BOOLEAN NOT NULL DEFAULT true,
    "enforce_report_reason" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MessageReportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanRequestConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "webhook_channel" TEXT,
    "automatically_timeout" BOOLEAN NOT NULL DEFAULT false,
    "immune_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notify_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enforce_submission_reason" BOOLEAN NOT NULL DEFAULT true,
    "enforce_deny_reason" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BanRequestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentFilterConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "use_native_automod" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "detectors" "Detector"[] DEFAULT ARRAY[]::"Detector"[],
    "detector_mode" "DetectorMode" NOT NULL DEFAULT 'Medium',
    "verbosity" "ContentFilterVerbosity" NOT NULL DEFAULT 'Medium',
    "immune_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notify_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ocr_filter_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ocr_filter_regex" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ContentFilterConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentFilterChannelScoping" (
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "type" INTEGER NOT NULL,

    CONSTRAINT "ContentFilterChannelScoping_pkey" PRIMARY KEY ("guild_id","channel_id")
);

-- CreateTable
CREATE TABLE "ContentFilterAlert" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "alert_message_id" TEXT NOT NULL,
    "alert_channel_id" TEXT NOT NULL,
    "offender_id" TEXT NOT NULL,
    "detectors" "Detector"[] DEFAULT ARRAY[]::"Detector"[],
    "highest_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mod_status" "ContentFilterStatus" NOT NULL DEFAULT 'Pending',
    "del_status" "ContentFilterStatus" NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFilterAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentFilterLog" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFilterLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanRequest" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_muted_automatically" BOOLEAN NOT NULL DEFAULT false,
    "status" "RequestStatus" NOT NULL DEFAULT 'Pending',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by" TEXT NOT NULL,
    "duration" BIGINT,
    "reason" TEXT NOT NULL,

    CONSTRAINT "BanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryBan" (
    "guild_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "MessageReport" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "message_url" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT,
    "reported_at" TIMESTAMP(3) NOT NULL,
    "reported_by" TEXT NOT NULL,
    "report_reason" TEXT NOT NULL,
    "additional_reporters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ReportStatus" NOT NULL DEFAULT 'Pending',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HighlightConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_patterns" INTEGER NOT NULL DEFAULT 15,

    CONSTRAINT "HighlightConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Highlight" (
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_blacklist" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("user_id","guild_id")
);

-- CreateTable
CREATE TABLE "HighlightChannelScoping" (
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "type" INTEGER NOT NULL,

    CONSTRAINT "HighlightChannelScoping_pkey" PRIMARY KEY ("user_id","guild_id","channel_id")
);

-- CreateTable
CREATE TABLE "QuickMuteConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "purge_limit" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "QuickMuteConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickMuteChannelScoping" (
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "type" INTEGER NOT NULL,

    CONSTRAINT "QuickMuteChannelScoping_pkey" PRIMARY KEY ("guild_id","channel_id")
);

-- CreateTable
CREATE TABLE "QuickMute" (
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "duration" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "purge_amount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuickMute_pkey" PRIMARY KEY ("user_id","guild_id","reaction")
);

-- CreateTable
CREATE TABLE "QuickPurgeConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_limit" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "QuickPurgeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickPurgeChannelScoping" (
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "type" INTEGER NOT NULL,

    CONSTRAINT "QuickPurgeChannelScoping_pkey" PRIMARY KEY ("guild_id","channel_id")
);

-- CreateTable
CREATE TABLE "QuickPurge" (
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "purge_amount" INTEGER NOT NULL,

    CONSTRAINT "QuickPurge_pkey" PRIMARY KEY ("user_id","guild_id","reaction")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "sticker_id" TEXT,
    "reference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "content" TEXT,
    "attachments" TEXT[],
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionScope" (
    "guild_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "allowed_permissions" "UserPermission"[] DEFAULT ARRAY[]::"UserPermission"[],

    CONSTRAINT "PermissionScope_pkey" PRIMARY KEY ("guild_id","role_id")
);

-- CreateTable
CREATE TABLE "LoggingWebhook" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "events" "LoggingEvent"[] DEFAULT ARRAY[]::"LoggingEvent"[]
);

-- CreateIndex
CREATE INDEX "ContentFilterAlert_guild_id_channel_id_created_at_idx" ON "ContentFilterAlert"("guild_id", "channel_id", "created_at");

-- CreateIndex
CREATE INDEX "ContentFilterAlert_message_id_idx" ON "ContentFilterAlert"("message_id");

-- CreateIndex
CREATE INDEX "ContentFilterLog_alert_id_idx" ON "ContentFilterLog"("alert_id");

-- CreateIndex
CREATE INDEX "ContentFilterLog_created_at_idx" ON "ContentFilterLog"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryBan_guild_id_target_id_key" ON "TemporaryBan"("guild_id", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "LoggingWebhook_id_key" ON "LoggingWebhook"("id");

-- AddForeignKey
ALTER TABLE "MessageReportConfig" ADD CONSTRAINT "MessageReportConfig_id_fkey" FOREIGN KEY ("id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanRequestConfig" ADD CONSTRAINT "BanRequestConfig_id_fkey" FOREIGN KEY ("id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFilterConfig" ADD CONSTRAINT "ContentFilterConfig_id_fkey" FOREIGN KEY ("id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFilterChannelScoping" ADD CONSTRAINT "ContentFilterChannelScoping_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "ContentFilterConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFilterAlert" ADD CONSTRAINT "ContentFilterAlert_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentFilterLog" ADD CONSTRAINT "ContentFilterLog_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanRequest" ADD CONSTRAINT "BanRequest_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightConfig" ADD CONSTRAINT "HighlightConfig_id_fkey" FOREIGN KEY ("id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightChannelScoping" ADD CONSTRAINT "HighlightChannelScoping_user_id_guild_id_fkey" FOREIGN KEY ("user_id", "guild_id") REFERENCES "Highlight"("user_id", "guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMuteConfig" ADD CONSTRAINT "QuickMuteConfig_id_fkey" FOREIGN KEY ("id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMuteChannelScoping" ADD CONSTRAINT "QuickMuteChannelScoping_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "QuickMuteConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMute" ADD CONSTRAINT "QuickMute_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickPurgeConfig" ADD CONSTRAINT "QuickPurgeConfig_id_fkey" FOREIGN KEY ("id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickPurgeChannelScoping" ADD CONSTRAINT "QuickPurgeChannelScoping_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "QuickPurgeConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickPurge" ADD CONSTRAINT "QuickPurge_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionScope" ADD CONSTRAINT "PermissionScope_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggingWebhook" ADD CONSTRAINT "LoggingWebhook_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
