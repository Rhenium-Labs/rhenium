/**
 * Field labels used on content-filter alert embeds.
 */
export const ContentFilterFieldNames = {
	Offender: "Offender",
	MessageLink: "Message",
	Flags: "Flags",
	ScanResults: "Detections"
} as const;

/**
 * Button labels used for moderator actions on content-filter alerts.
 */
export const ContentFilterButtonNames = {
	Content: "View Details",
	DelMessage: "Delete Message",
	False: "Mark False Positive",
	Resolve: "Resolve Alert"
} as const;

/**
 * Human-readable scan source labels.
 */
export const ScanTypes = {
	Automated: "Automated Scan",
	Heuristic: "Heuristic Scan"
} as const;

export type ScanType = (typeof ScanTypes)[keyof typeof ScanTypes];

const CUSTOM_ID_PREFIX = "cfb1";

/**
 * Helpers for constructing versioned custom IDs used by CF action buttons.
 */
export const ContentFilterCustomIds = {
	prefix: CUSTOM_ID_PREFIX,
	del: (messageId: string, channelId: string): string =>
		`${CUSTOM_ID_PREFIX}:del:${messageId}:${channelId}`,
	resolve: (messageId: string): string => `${CUSTOM_ID_PREFIX}:res:${messageId}`,
	falsePositive: (channelId: string, messageId: string): string =>
		`${CUSTOM_ID_PREFIX}:fp:${channelId}:${messageId}`,
	content: (messageId: string): string => `${CUSTOM_ID_PREFIX}:content:${messageId}`
} as const;

export type ParsedContentFilterCustomId =
	| {
			action: "delete";
			messageId: string;
			channelId: string;
	  }
	| {
			action: "resolve";
			messageId: string;
	  }
	| {
			action: "false";
			messageId: string;
			channelId: string;
	  }
	| {
			action: "content";
			messageId: string;
	  };

/**
 * Parses a content-filter custom ID payload into a typed action shape.
 *
 * @param customId Raw interaction custom ID.
 * @returns Parsed payload, or null when the payload is malformed/unsupported.
 */
export function parseContentFilterCustomId(customId: string): ParsedContentFilterCustomId | null {
	const parts = customId.split(":");

	if (parts[0] !== CUSTOM_ID_PREFIX) {
		return null;
	}

	const action = parts[1];

	switch (action) {
		case "del": {
			if (parts.length !== 4) return null;
			return {
				action: "delete",
				messageId: parts[2],
				channelId: parts[3]
			};
		}
		case "res": {
			if (parts.length !== 3) return null;
			return {
				action: "resolve",
				messageId: parts[2]
			};
		}
		case "fp": {
			if (parts.length !== 4) return null;
			return {
				action: "false",
				channelId: parts[2],
				messageId: parts[3]
			};
		}
		case "content": {
			if (parts.length !== 3) return null;
			return {
				action: "content",
				messageId: parts[2]
			};
		}
		default:
			return null;
	}
}
