export const ContentFilterFieldNames = {
	ContentFound: "Content found",
	MessageLink: "Link to message",
	Offender: "Offender",
	ResponseTime: "Response time",
	DelStatus: "Deletion status",
	ModStatus: "Moderation status",
	ScanStatus: "Scan status",
	ScanResults: "Scan results"
} as const;
export type ContentFilterFieldName = (typeof ContentFilterFieldNames)[keyof typeof ContentFilterFieldNames];

export const ContentFilterButtonNames = {
	Content: "View content",
	DelMessage: "Delete message",
	False: "False positive",
	Resolve: "Resolve"
} as const;
export type ContentFilterButtonName = (typeof ContentFilterButtonNames)[keyof typeof ContentFilterButtonNames];

export const ScanTypes = {
	Automated: "Automated scan",
	Heuristic: "Heuristic scan"
} as const;
export type ScanType = (typeof ScanTypes)[keyof typeof ScanTypes];
