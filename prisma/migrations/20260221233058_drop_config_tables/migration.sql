/*
  Warnings:

  - You are about to drop the `BanRequestConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContentFilterChannelScoping` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContentFilterConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HighlightConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LoggingWebhook` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MessageReportConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PermissionScope` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuickMuteChannelScoping` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuickMuteConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuickPurgeChannelScoping` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuickPurgeConfig` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BanRequestConfig" DROP CONSTRAINT "BanRequestConfig_id_fkey";

-- DropForeignKey
ALTER TABLE "ContentFilterChannelScoping" DROP CONSTRAINT "ContentFilterChannelScoping_guild_id_fkey";

-- DropForeignKey
ALTER TABLE "ContentFilterConfig" DROP CONSTRAINT "ContentFilterConfig_id_fkey";

-- DropForeignKey
ALTER TABLE "HighlightConfig" DROP CONSTRAINT "HighlightConfig_id_fkey";

-- DropForeignKey
ALTER TABLE "LoggingWebhook" DROP CONSTRAINT "LoggingWebhook_guild_id_fkey";

-- DropForeignKey
ALTER TABLE "MessageReportConfig" DROP CONSTRAINT "MessageReportConfig_id_fkey";

-- DropForeignKey
ALTER TABLE "PermissionScope" DROP CONSTRAINT "PermissionScope_guild_id_fkey";

-- DropForeignKey
ALTER TABLE "QuickMuteChannelScoping" DROP CONSTRAINT "QuickMuteChannelScoping_guild_id_fkey";

-- DropForeignKey
ALTER TABLE "QuickMuteConfig" DROP CONSTRAINT "QuickMuteConfig_id_fkey";

-- DropForeignKey
ALTER TABLE "QuickPurgeChannelScoping" DROP CONSTRAINT "QuickPurgeChannelScoping_guild_id_fkey";

-- DropForeignKey
ALTER TABLE "QuickPurgeConfig" DROP CONSTRAINT "QuickPurgeConfig_id_fkey";

-- AlterTable
ALTER TABLE "Guild" ALTER COLUMN "config" DROP DEFAULT;

-- DropTable
DROP TABLE "BanRequestConfig";

-- DropTable
DROP TABLE "ContentFilterChannelScoping";

-- DropTable
DROP TABLE "ContentFilterConfig";

-- DropTable
DROP TABLE "HighlightConfig";

-- DropTable
DROP TABLE "LoggingWebhook";

-- DropTable
DROP TABLE "MessageReportConfig";

-- DropTable
DROP TABLE "PermissionScope";

-- DropTable
DROP TABLE "QuickMuteChannelScoping";

-- DropTable
DROP TABLE "QuickMuteConfig";

-- DropTable
DROP TABLE "QuickPurgeChannelScoping";

-- DropTable
DROP TABLE "QuickPurgeConfig";

-- DropEnum
DROP TYPE "ContentFilterVerbosity";

-- DropEnum
DROP TYPE "DetectorMode";

-- DropEnum
DROP TYPE "LoggingEvent";

-- DropEnum
DROP TYPE "UserPermission";
