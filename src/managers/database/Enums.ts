export const RequestStatus = {
    AutoResolved: "AutoResolved",
    Pending: "Pending",
    Disregarded: "Disregarded",
    Accepted: "Accepted",
    Denied: "Denied"
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];
export const ReportStatus = {
    AutoResolved: "AutoResolved",
    Pending: "Pending",
    Disregarded: "Disregarded",
    Resolved: "Resolved"
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];
export const Detector = {
    NSFW: "NSFW",
    OCR: "OCR",
    TEXT: "TEXT"
} as const;
export type Detector = (typeof Detector)[keyof typeof Detector];
export const DetectorMode = {
    Lenient: "Lenient",
    Medium: "Medium",
    Strict: "Strict"
} as const;
export type DetectorMode = (typeof DetectorMode)[keyof typeof DetectorMode];
export const ContentFilterVerbosity = {
    Minimal: "Minimal",
    Medium: "Medium",
    Verbose: "Verbose"
} as const;
export type ContentFilterVerbosity = (typeof ContentFilterVerbosity)[keyof typeof ContentFilterVerbosity];
export const ContentFilterStatus = {
    Pending: "Pending",
    Resolved: "Resolved",
    False: "False",
    Deleted: "Deleted"
} as const;
export type ContentFilterStatus = (typeof ContentFilterStatus)[keyof typeof ContentFilterStatus];
export const UserPermission = {
    ReviewMessageReports: "ReviewMessageReports",
    ReviewBanRequests: "ReviewBanRequests",
    UseHighlights: "UseHighlights",
    UseQuickMute: "UseQuickMute",
    UseQuickPurge: "UseQuickPurge"
} as const;
export type UserPermission = (typeof UserPermission)[keyof typeof UserPermission];
export const LoggingEvent = {
    MessageReportReviewed: "MessageReportReviewed",
    BanRequestReviewed: "BanRequestReviewed",
    BanRequestResult: "BanRequestResult",
    QuickPurgeResult: "QuickPurgeResult",
    QuickPurgeExecuted: "QuickPurgeExecuted",
    QuickMuteResult: "QuickMuteResult",
    QuickMuteExecuted: "QuickMuteExecuted"
} as const;
export type LoggingEvent = (typeof LoggingEvent)[keyof typeof LoggingEvent];
