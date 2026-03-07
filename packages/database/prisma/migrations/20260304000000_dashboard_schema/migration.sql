-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "dashboard";

-- Move Session table from public to dashboard
ALTER TABLE "public"."Session" SET SCHEMA "dashboard";

-- CreateTable
CREATE TABLE "dashboard"."UserGuildCache" (
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "permissions" BIGINT NOT NULL,
    "bot_in_guild" BOOLEAN NOT NULL DEFAULT false,
    "cached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGuildCache_pkey" PRIMARY KEY ("user_id","guild_id")
);

-- CreateIndex
CREATE INDEX "UserGuildCache_user_id_cached_at_idx" ON "dashboard"."UserGuildCache"("user_id", "cached_at");
