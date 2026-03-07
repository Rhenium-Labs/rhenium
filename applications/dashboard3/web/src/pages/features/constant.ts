export const CONTENT_FILTER = {
	DETECTORS: ["NSFW", "OCR", "TEXT"],
	DETECTOR_MODE_OPTIONS: [
		{
			value: "Lenient",
			label: "Lenient",
			description: "Light filtering, best for relaxed servers."
		},
		{
			value: "Medium",
			label: "Medium",
			description: "Balanced filtering for most communities."
		},
		{
			value: "Strict",
			label: "Strict",
			description: "Aggressive filtering, may flag borderline content."
		}
	],
    VERBOSITY_OPTIONS: [
        {
            value: "Minimal",
            label: "Minimal",
            description: "Only important actions and errors are logged.",
        },
        {
            value: "Medium",
            label: "Medium",
            description: "Standard activity and moderation actions are logged.",
        },
        {
            value: "Verbose",
            label: "Verbose",
            description: "Detailed diagnostic logging for debugging.",
        },
    ],
}
