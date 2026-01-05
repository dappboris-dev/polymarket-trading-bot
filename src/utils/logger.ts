/**
 * Simple logger with levels and timestamps
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR'
};

export class Logger {
    private context: string;
    private level: LogLevel;

    constructor(context: string, level: LogLevel = LogLevel.INFO) {
        this.context = context;
        this.level = level;
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    private formatMessage(level: LogLevel, message: string, data?: any): string {
        const timestamp = new Date().toISOString();
        const levelName = LOG_LEVEL_NAMES[level];
        let formatted = `[${timestamp}] [${levelName}] [${this.context}] ${message}`;

        if (data !== undefined) {
            if (data instanceof Error) {
                formatted += `\n  Error: ${data.message}`;
                if (data.stack) {
                    formatted += `\n  Stack: ${data.stack.split('\n').slice(1, 4).join('\n        ')}`;
                }
            } else if (typeof data === 'object') {
                try {
                    formatted += `\n  Data: ${JSON.stringify(data, null, 2).split('\n').join('\n  ')}`;
                } catch {
                    formatted += `\n  Data: [Unable to stringify]`;
                }
            } else {
                formatted += ` | ${data}`;
            }
        }

        return formatted;
    }

    debug(message: string, data?: any): void {
        if (this.level <= LogLevel.DEBUG) {
            console.log(this.formatMessage(LogLevel.DEBUG, message, data));
        }
    }

    info(message: string, data?: any): void {
        if (this.level <= LogLevel.INFO) {
            console.log(this.formatMessage(LogLevel.INFO, message, data));
        }
    }

    warn(message: string, data?: any): void {
        if (this.level <= LogLevel.WARN) {
            console.warn(this.formatMessage(LogLevel.WARN, message, data));
        }
    }

    error(message: string, data?: any): void {
        if (this.level <= LogLevel.ERROR) {
            console.error(this.formatMessage(LogLevel.ERROR, message, data));
        }
    }
}

export function createLogger(context: string): Logger {
    const levelStr = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    const level = LogLevel[levelStr as keyof typeof LogLevel] ?? LogLevel.INFO;
    return new Logger(context, level);
}
