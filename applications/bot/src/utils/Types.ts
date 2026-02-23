export type SimpleResult<T = undefined> =
	| { ok: false; message: string }
	| ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }));
