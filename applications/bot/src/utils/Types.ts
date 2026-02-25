/**
 * A utility type representing the result of an operation, which can either be successful or a failure.
 */
export type SimpleResult<T = undefined> =
	| { ok: false; message: string }
	| ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }));
