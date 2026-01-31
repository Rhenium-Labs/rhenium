import { Container, Piece, container } from "@sapphire/pieces";
import { Ctor } from "@sapphire/utilities";
import {
	Colors,
	Message,
	MessageFlags,
	type CommandInteraction,
	type MessageReplyOptions,
	type InteractionReplyOptions
} from "discord.js";

import type { InteractionReplyData, MessageReplyData } from "#utils/Types.js";
import type { ComponentInteraction } from "./structures/Component.js";

import Messages from "#utils/Messages.js";

// Structures
export * from "./structures/Rhenium.js";
export * from "./structures/Component.js";
export * from "./structures/Command.js";
export * from "./structures/EventListener.js";

// Decorators

/**
 * Utility to make a class decorator with lighter syntax and inferred types.
 *
 * @param fn The class to decorate.
 * @see {@link ApplyOptions}
 */
function createClassDecorator<TFunction extends (...args: any[]) => void>(fn: TFunction): ClassDecorator {
	return fn;
}

/**
 * Creates a new proxy to efficiently add properties to class without creating subclasses.
 *
 * @param target The constructor of the class to modify.
 * @param handler The handler function to modify the constructor behavior for the target.
 */
function createProxy<T extends object>(target: T, handler: Omit<ProxyHandler<T>, "get">): T {
	return new Proxy(target, {
		...handler,
		get: (target, property) => {
			const value = Reflect.get(target, property);
			return typeof value === "function" ? (...args: readonly unknown[]) => value.apply(target, args) : value;
		}
	});
}

/**
 * Decorator function that applies given options to any Rhenium piece.
 * @param optionsOrFn The options or function that returns options to pass to the piece constructor.
 * @returns A class decorator.
 */
export function ApplyOptions<T extends Piece.Options>(
	optionsOrFn: T | ((parameters: ApplyOptionsCallbackParameters) => T)
): ClassDecorator {
	return createClassDecorator((target: Ctor<ConstructorParameters<typeof Piece>, Piece>) =>
		createProxy(target, {
			construct: (ctor, [context, baseOptions = {}]: [Piece.LoaderContext, Piece.Options]) =>
				new ctor(context, {
					...baseOptions,
					...(typeof optionsOrFn === "function" ? optionsOrFn({ container, context }) : optionsOrFn)
				})
		})
	);
}

interface ApplyOptionsCallbackParameters {
	container: Container;
	context: Piece.LoaderContext;
}

// Utilities

/**
 * Processes command execution responses uniformly.
 *
 * @param type The type of response to process.
 * @param data The response data to process.
 * @returns A promise that resolves when the response has been processed.
 */

export async function processResponse<T extends ResponseType>(type: T, data: ResponseData<T>): Promise<void> {
	switch (type) {
		case "Message": {
			const { message, response } = data as ResponseData<"Message">;

			// Reply was handled manually.
			if (response === null) return;

			const { error, temporary, ...rest } = response;

			const options: MessageReplyOptions = error
				? {
						embeds: [{ description: error, color: Colors.Red }, ...(rest.embeds ?? [])],
						...rest
					}
				: { ...rest };

			const createdMessage = await Messages.reply(message, options);

			if (error || temporary) {
				setTimeout(() => {
					message.delete().catch(() => {});
					createdMessage.delete().catch(() => {});
				}, 7500);
			}

			return;
		}
		case "Interaction": {
			const { interaction, response } = data as ResponseData<"Interaction">;

			if (response === null) return;

			const { error, temporary, ...rest } = response;

			const defaultReplyOptions: InteractionReplyOptions = {
				flags: [MessageFlags.Ephemeral]
			};

			const options: InteractionReplyOptions = error
				? {
						...defaultReplyOptions,
						...rest,
						embeds: [{ description: error, color: Colors.Red }, ...(rest.embeds ?? [])]
					}
				: { ...defaultReplyOptions, ...rest };

			if (interaction.deferred || interaction.replied) {
				const { flags, ...editOptions } = options;
				await interaction.editReply(editOptions);
			} else {
				await interaction.reply(options);
			}

			if (error || temporary) {
				setTimeout(() => {
					interaction.deleteReply().catch(() => {});
				}, 7500);
			}

			return;
		}
	}
}

type ResponseType = "Message" | "Interaction";

type ResponseData<T extends ResponseType> = T extends "Message"
	? { message: Message<true>; response: MessageReplyData | null }
	: {
			interaction: CommandInteraction<"cached"> | ComponentInteraction;
			response: InteractionReplyData | null;
		};
