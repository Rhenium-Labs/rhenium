/*
  Warnings:

  - You are about to alter the column `duration` on the `BanRequest` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `auto_disregard_after` on the `MessageReportConfig` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `duration` on the `QuickMute` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- AlterTable
ALTER TABLE "BanRequest" ALTER COLUMN "duration" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "MessageReportConfig" ALTER COLUMN "auto_disregard_after" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "QuickMute" ALTER COLUMN "duration" SET DATA TYPE INTEGER;
