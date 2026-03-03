type LogLevel = "info" | "warn" | "error";

type LogMetadata = Record<string, unknown>;

function safeError(error: unknown): LogMetadata {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack
		};
	}

	return { value: String(error) };
}

function write(level: LogLevel, message: string, metadata?: LogMetadata) {
	const payload = {
		ts: new Date().toISOString(),
		service: "dashboard",
		level,
		message,
		...(metadata ?? {})
	};

	const line = JSON.stringify(payload);

	if (level === "error") {
		console.error(line);
		return;
	}

	if (level === "warn") {
		console.warn(line);
		return;
	}

	console.info(line);
}

const Logger = {
	info(message: string, metadata?: LogMetadata) {
		write("info", message, metadata);
	},

	warn(message: string, metadata?: LogMetadata) {
		write("warn", message, metadata);
	},

	error(message: string, metadata?: LogMetadata) {
		write("error", message, metadata);
	},

	errorWithCause(message: string, error: unknown, metadata?: LogMetadata) {
		write("error", message, {
			...(metadata ?? {}),
			error: safeError(error)
		});
	}
};

export default Logger;
