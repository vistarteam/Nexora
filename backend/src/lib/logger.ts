import { config } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal structured logger.
 *
 * Deliberately dependency-free — swap the `emit` function for pino/winston
 * later without touching any call site.
 */
function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  if (ORDER[level] < ORDER[config.logLevel]) return;

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
  };
  if (meta !== undefined) record.meta = meta;

  const line = `${JSON.stringify(record)}\n`;
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => emit('debug', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    error: (message, meta) => emit('error', scope, message, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export const logger = createLogger('nexora');
