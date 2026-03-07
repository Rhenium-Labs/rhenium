-- CreateTable
CREATE TABLE "dashboard"."ChannelCache" (
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelCache_pkey" PRIMARY KEY ("guild_id","channel_id")
);

-- CreateTable
CREATE TABLE "dashboard"."RoleCache" (
    "guild_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleCache_pkey" PRIMARY KEY ("guild_id","role_id")
);
