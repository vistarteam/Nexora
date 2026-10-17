import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The `backend/` directory. */
export const BACKEND_ROOT = path.resolve(here, '..', '..');
/** The repository root, one level above `backend/`. */
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

// The repository root `.env` is the documented location; `backend/.env` may
// override it for local experiments.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), override: true });

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 0 is valid: it asks the OS to pick any free port (handy in tests).
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Live data by default, from sources reachable on Iranian networks:
  //   auto    -> crypto from an Iranian exchange (Nobitex), forex/equities from a
  //              keyless global feed (Yahoo Finance)
  //   nobitex -> Nobitex only (crypto)
  //   yahoo   -> Yahoo Finance only (forex + equities)
  //   binance -> Binance public REST (crypto; blocked from Iranian IPs)
  //   none    -> no data; endpoints answer with an explicit "unavailable" status
  MARKET_DATA_PROVIDER: z
    .enum(['auto', 'binance', 'nobitex', 'yahoo', 'none'])
    .default('auto'),
  MARKET_DATA_API_KEY: z.string().optional().default(''),
  MARKET_DATA_BASE_URL: z.string().optional().default(''),
  // Optional origin overrides for the Iran-reachable providers (e.g. point
  // Nobitex at `https://apiv2.nobitex.ir`). Empty means use the built-in default.
  MARKET_DATA_NOBITEX_BASE_URL: z.string().optional().default(''),
  MARKET_DATA_YAHOO_BASE_URL: z.string().optional().default(''),
  MARKET_DATA_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(8000),
  MARKET_DATA_MAX_LIMIT: z.coerce.number().int().positive().max(5_000).default(1000),

  DEFAULT_SYMBOL: z.string().min(1).default('BINANCE:BTCUSDT'),
  DEFAULT_TIMEFRAME: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']).default('1h'),

  ANALYSIS_ENGINE_PYTHON: z.string().min(1).default('python'),
  ANALYSIS_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(15_000),
  ANALYSIS_ENGINE_FALLBACK_TS: booleanish.default('true'),

  STORAGE_DRIVER: z.enum(['json', 'memory']).default('json'),
  STORAGE_DIR: z.string().default('.data'),
  DATABASE_URL: z.string().optional().default(''),
});

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig(env: z.infer<typeof envSchema>) {
  const storageDir = path.isAbsolute(env.STORAGE_DIR)
    ? env.STORAGE_DIR
    : path.join(REPO_ROOT, env.STORAGE_DIR);

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    marketData: {
      provider: env.MARKET_DATA_PROVIDER,
      apiKey: env.MARKET_DATA_API_KEY,
      baseUrl: env.MARKET_DATA_BASE_URL,
      nobitexBaseUrl: env.MARKET_DATA_NOBITEX_BASE_URL,
      yahooBaseUrl: env.MARKET_DATA_YAHOO_BASE_URL,
      timeoutMs: env.MARKET_DATA_TIMEOUT_MS,
      maxLimit: env.MARKET_DATA_MAX_LIMIT,
    },
    defaults: {
      symbol: env.DEFAULT_SYMBOL,
      timeframe: env.DEFAULT_TIMEFRAME,
    },
    analysisEngine: {
      executable: env.ANALYSIS_ENGINE_PYTHON,
      timeoutMs: env.ANALYSIS_ENGINE_TIMEOUT_MS,
      allowTypeScriptFallback: env.ANALYSIS_ENGINE_FALLBACK_TS,
      /** Directory that contains `cli.py`. */
      root: path.join(REPO_ROOT, 'analysis-engine'),
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      dir: storageDir,
      databaseUrl: env.DATABASE_URL,
    },
  } as const;
}

/**
 * An environment variable that is present but empty means "not configured" —
 * shells, CI systems and test runners routinely export empty strings for
 * optional variables, and `''` must not be coerced into `0`/`false`.
 */
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
  ),
);

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Fail fast: a misconfigured process should never start serving traffic.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config: AppConfig = buildConfig(parsed.data);
export const SERVICE_NAME = 'nexora-api';
export const SERVICE_VERSION = '0.1.0';
