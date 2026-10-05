import { bootEnv } from '../config/bootConfig.js';

type LoggerLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE'];
const currentLogLevel = bootEnv.GOV_LOG_LEVEL.toUpperCase();

function shouldLog(level: string) {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(currentLogLevel);
}

class Logger {
    private service: string;
    private tag?: string;

    constructor(service: string) {
        this.service = service;
    }

    setTag(tag: string) {
        this.tag = tag;
        return this;
    }

    info(...messages: unknown[]) {
        if (shouldLog('INFO')) this._log('info', ...messages);
    }

    log(...messages: unknown[]) {
        this.info(...messages);
    }

    warn(...messages: unknown[]) {
        if (shouldLog('WARN')) this._log('warn', ...messages);
    }

    error(...messages: unknown[]) {
        if (shouldLog('ERROR')) this._log('error', ...messages);
    }

    debug(...messages: unknown[]) {
        if (shouldLog('DEBUG')) this._log('debug', ...messages);
    }

    private _log(level: LoggerLevel, ...messages: unknown[]) {
        const formatted = this._formatLog(level, ...messages);
        switch (level) {
            case 'info':
                console.info(...formatted);
                break;
            case 'warn':
                console.warn(...formatted);
                break;
            case 'error':
                console.error(...formatted);
                break;
            case 'debug':
                console.debug(...formatted);
                break;
            default:
                console.log(...formatted);
        }
    }

    private _formatLog(level: LoggerLevel, ...messages: unknown[]): unknown[] {
        const timestamp = new Date().toISOString();
        const service = this.service ? `${this.service}` : '';
        const tag = this.tag ? `: ${this.tag}` : '';
        const levelLabel = level.toUpperCase();
        const coloredLevel = colorize(levelLabel, LEVEL_COLORS[level]);
        const prefix = `[${timestamp}] [${service}${tag}] [${coloredLevel}]:`;
        return [prefix, ...messages];
    }
}

// Simple color codes for terminal output
const ANSI_COLORS = {
    RESET: '\x1b[0m',
    GRAY: '\x1b[90m',
    BLUE: '\x1b[34m',
    YELLOW: '\x1b[33m',
    RED: '\x1b[31m',
};

const LEVEL_COLORS: Record<LoggerLevel, string> = {
    info: ANSI_COLORS.BLUE,
    warn: ANSI_COLORS.YELLOW,
    error: ANSI_COLORS.RED,
    debug: ANSI_COLORS.GRAY,
};

function isColorEnabled() {
    return process.stdout.isTTY && process.env.NO_COLOR === undefined;
}

function colorize(text: string, color: string) {
    if (!isColorEnabled()) return text;
    return `${color}${text}${ANSI_COLORS.RESET}`;
}

// Factory to get a logger for a specific service
export function getLogger(service: string | null = null): Logger {
    return new Logger(service || bootEnv.GOV_SERVICE_NAME);
}
