import { Container, Piece, container } from "@sapphire/pieces";
import { Ctor } from "@sapphire/utilities";

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
function createClassDecorator<TFunction extends (...args: any[]) => void>(
	fn: TFunction
): ClassDecorator {
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
			return typeof value === "function"
				? (...args: readonly unknown[]) => value.apply(target, args)
				: value;
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
			construct: (
				ctor,
				[context, baseOptions = {}]: [Piece.LoaderContext, Piece.Options]
			) =>
				new ctor(context, {
					...baseOptions,
					...(typeof optionsOrFn === "function"
						? optionsOrFn({ container, context })
						: optionsOrFn)
				})
		})
	);
}

interface ApplyOptionsCallbackParameters {
	container: Container;
	context: Piece.LoaderContext;
}
