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
export const ContentFilterStatus = {
    Pending: "Pending",
    Resolved: "Resolved",
    False: "False",
    Deleted: "Deleted"
} as const;
export type ContentFilterStatus = (typeof ContentFilterStatus)[keyof typeof ContentFilterStatus];
