import { InteractionReplyOptions, MessageCreateOptions } from "discord.js";

export type InteractionReplyData = InteractionReplyOptions & { error?: string; temporary?: boolean };

export type MessageReplyData = MessageCreateOptions & { error?: string; temporary?: boolean };
