
/**
 * 📢 EIDOLON STRUCTURED LOGGER
 *
 * Zero-dependency structured JSON logger.
 * - Writes exclusively to STDERR → MCP STDOUT channel stays clean.
 * - JSON output → pluggable into ELK / Grafana / any log aggregator.
 * - Automatic PII/secrets redaction.
 * - Correlation ID support for tracing request flows.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/** Keys whose values will be redacted in log output */
const REDACTED_KEYS = new Set([
    'password', 'secret', 'key', 'apiKey', 'api_key',
    'token', 'accessToken', 'access_token', 'privateKey', 'private_key',
    'mnemonic', 'seed', 'authorization', 'Authorization',
]);

/** Normalize any context value to a plain Record for JSON logging */
function normalizeContext(ctx: unknown): Record<string, unknown> {
    if (ctx === null || ctx === undefined) return {};
    if (ctx instanceof Error) {
        return { error: ctx.message, stack: ctx.stack, name: ctx.name };
    }
    if (typeof ctx !== 'object') return { value: ctx };
    return ctx as Record<string, unknown>;
}

function redact(obj: any, depth = 0): any {
    if (depth > 10 || obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => redact(item, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = REDACTED_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
}

interface LogRecord {
    ts: string;          // ISO-8601 timestamp
    level: LogLevel;
    msg: string;
    pid: number;
    name: string;
    cid?: string;        // correlationId
    [key: string]: unknown;  // arbitrary context
}

class EidolonLogger {
    private readonly minLevel: number;
    private readonly name: string;
    /** Optional correlation ID injected per-request */
    private correlationId: string | undefined;

    constructor() {
        const raw = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
        this.minLevel = LEVEL_PRIORITY[raw] ?? LEVEL_PRIORITY.info;
        this.name = process.env.LOG_NAME || 'eidolon';
    }

    /** Set a correlation ID for the current async context */
    setCorrelationId(id: string | undefined): void {
        this.correlationId = id;
    }

    private write(level: LogLevel, msg: string, context?: unknown): void {
        if (LEVEL_PRIORITY[level] < this.minLevel) return;

        const record: LogRecord = {
            ts: new Date().toISOString(),
            level,
            msg,
            pid: process.pid,
            name: this.name,
        };

        if (this.correlationId) record.cid = this.correlationId;
        if (context !== undefined) Object.assign(record, redact(normalizeContext(context)));

        // Force STDERR — never touches STDOUT (MCP JSON-RPC safety)
        process.stderr.write(JSON.stringify(record) + '\n');
    }

    info(msg: string, context?: unknown): void {
        this.write('info', msg, context);
    }

    warn(msg: string, context?: unknown): void {
        this.write('warn', msg, context);
    }

    error(msg: string, context?: unknown): void {
        this.write('error', msg, context);
    }

    debug(msg: string, context?: unknown): void {
        if (process.env.EIDOLON_DEBUG === '1') {
            this.write('debug', msg, context);
        }
    }
}

const _logger = new EidolonLogger();

/**
 * Structured logger singleton.
 * Drop-in replacement for the old console-based Logger.
 */
export class Logger {
    static info(msg: string, context?: unknown): void {
        _logger.info(msg, context);
    }

    static warn(msg: string, context?: unknown): void {
        _logger.warn(msg, context);
    }

    static error(msg: string, context?: unknown): void {
        _logger.error(msg, context);
    }

    static debug(msg: string, context?: unknown): void {
        _logger.debug(msg, context);
    }

    /** Inject a correlation ID (e.g. request ID) for downstream logs */
    static setCorrelationId(id: string | undefined): void {
        _logger.setCorrelationId(id);
    }
}
