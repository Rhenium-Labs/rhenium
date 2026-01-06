/**
 * ANSI color codes for terminal output.
 */
export const LogColor = {
	Purple: "\x1b[35m",
	Green: "\x1b[32m",
	Orange: "\x1b[38;5;208m",
	Yellow: "\x1b[33m",
	Reset: "\x1b[0m",
	Cyan: "\x1b[36m",
	Grey: "\x1b[90m",
	Red: "\x1b[31m",
	Blue: "\x1b[34m",
	Magenta: "\x1b[95m"
} as const;

export type LogColor = (typeof LogColor)[keyof typeof LogColor];

/**
 * Default log levels.
 */
export const LogLevel = {
	Debug: "DEBUG",
	Info: "INFO",
	Success: "SUCCESS",
	Warn: "WARN",
	Error: "ERROR",
	ErrorWithId: "ERROR",
	Fatal: "FATAL"
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Options for custom log messages.
 */

export interface LogOptions {
	color?: keyof typeof LogColor;
	fullColor?: boolean;
}

export default class Logger {
	public static debug(...values: unknown[]): void {
		this._log(LogLevel.Debug, ...values);
	}

	public static info(...values: unknown[]): void {
		this._log(LogLevel.Info, ...values);
	}

	public static success(...values: unknown[]): void {
		this._log(LogLevel.Success, ...values);
	}

	public static warn(...values: unknown[]): void {
		this._log(LogLevel.Warn, ...values);
	}

	public static error(...values: unknown[]): void {
		this._log(LogLevel.Error, ...values);
	}

	public static tracable(sentryId: string, ...values: unknown[]): void {
		const timestamp = new Date().toISOString();
		const ts = `${LogColor.Grey}[${timestamp}]${LogColor.Reset}`;
		const color = this._getColor(LogLevel.Error);
		const badge = `${color}[${sentryId}]${LogColor.Reset}`;

		console.log(`${ts} ${badge}`, ...values);
	}

	public static fatal(...values: unknown[]): void {
		this._log(LogLevel.Fatal, ...values);
	}

	/**
	 * Logs a custom message with a specified level and optional color.
	 *
	 * @param level The custom log level.
	 * @param message The message to log.
	 * @param options Optional log options such as color.
	 */
	public static custom(level: string, message: string, options?: LogOptions): void {
		const timestamp = new Date().toISOString();
		const ts = `${LogColor.Grey}[${timestamp}]${LogColor.Reset}`;
		const color = options?.color ? LogColor[options.color] : "";

		if (options?.fullColor) {
			console.log(`${ts} ${color}[${level}] ${message}${LogColor.Reset}`);
		} else if (color) {
			console.log(`${ts} ${color}[${level}]${LogColor.Reset} ${message}`);
		} else {
			console.log(`${ts} [${level}] ${message}`);
		}
	}

	/**
	 * Helper method to log messages with timestamp and level.
	 *
	 * @param level The log level.
	 * @param values The values to log.
	 */

	private static _log(level: LogLevel, ...values: unknown[]): void {
		const timestamp = new Date().toISOString();
		const ts = `${LogColor.Grey}[${timestamp}]${LogColor.Reset}`;
		const color = this._getColor(level);
		const badge = `${color}[${level}]${LogColor.Reset}`;

		console.log(`${ts} ${badge}`, ...values);
	}

	/**
	 * Helper method to get the color associated with a log level.
	 *
	 * @param level The log level.
	 * @returns The ANSI color code.
	 */

	private static _getColor(level: LogLevel): string {
		switch (level) {
			case LogLevel.Debug:
				return LogColor.Magenta;
			case LogLevel.Info:
				return LogColor.Cyan;
			case LogLevel.Success:
				return LogColor.Green;
			case LogLevel.Warn:
				return LogColor.Yellow;
			case LogLevel.Error:
			case LogLevel.ErrorWithId:
			case LogLevel.Fatal:
				return LogColor.Red;
		}
	}
}
