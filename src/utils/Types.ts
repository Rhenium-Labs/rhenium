export type SimpleResult<T = undefined> =
	| { ok: false; message: string }
	| ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }));

export type ChannelScoping = {
	include_channels: string[];
	exclude_channels: string[];
};

export type RawChannelScoping = {
	type: number;
	channel_id: string;
};
