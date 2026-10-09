import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../../config/env.js';
import { createLogger } from '../../lib/logger.js';
import type { AnalysisStatus } from '../../types/domain.js';
import type { EngineOptions, EngineRunResult } from './types.js';

const log = createLogger('analysis:python');

const VALID_STATUSES: readonly AnalysisStatus[] = ['ok', 'insufficient_data', 'unavailable'];

/** Raised when the Python process could not be used at all. */
export class PythonEngineUnavailableError extends Error {
  constructor(
    message: string,
    readonly detail: { reason: 'spawn_failed' | 'timeout' | 'bad_output' | 'crashed'; stderr?: string },
  ) {
    super(message);
    this.name = 'PythonEngineUnavailableError';
  }
}

export interface PythonEngineInput {
  symbol: string;
  timeframe: string;
  candles: unknown[];
  /** Indicator options, mirroring the engine's own defaults. */
  options?: EngineOptions;
}

/** Absolute path to `analysis-engine/cli.py`. */
export function cliPath(): string {
  return path.join(config.analysisEngine.root, 'cli.py');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Coerce whatever the Python process printed into an `EngineRunResult`.
 *
 * The contract is validated rather than trusted: a partially-written or
 * garbage result must not be able to reach the API as if it were analysis.
 */
function coerceResult(parsed: unknown): EngineRunResult {
  if (!isRecord(parsed)) {
    throw new PythonEngineUnavailableError('engine output was not a JSON object', {
      reason: 'bad_output',
    });
  }

  const status = parsed.status;
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status as AnalysisStatus)) {
    throw new PythonEngineUnavailableError(`engine returned an unknown status: ${String(status)}`, {
      reason: 'bad_output',
    });
  }

  const engineRecord = isRecord(parsed.engine) ? parsed.engine : {};
  const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];

  return {
    engine: {
      id: 'python',
      name: typeof engineRecord.name === 'string' ? engineRecord.name : 'nexora-analysis-engine',
      version: typeof engineRecord.version === 'string' ? engineRecord.version : 'unknown',
    },
    status: status as AnalysisStatus,
    requiredCandles: Number.isFinite(Number(parsed.requiredCandles))
      ? Number(parsed.requiredCandles)
      : 0,
    receivedCandles: Number.isFinite(Number(parsed.receivedCandles))
      ? Number(parsed.receivedCandles)
      : 0,
    facts: isRecord(parsed.facts) ? (parsed.facts as unknown as EngineRunResult['facts']) : null,
    interpretation: isRecord(parsed.interpretation)
      ? (parsed.interpretation as unknown as EngineRunResult['interpretation'])
      : null,
    scenarios: scenarios as EngineRunResult['scenarios'],
    warnings,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
  };
}

/**
 * Run one analysis through the Python engine.
 *
 * The payload is streamed to the process over stdin and the result is read from
 * stdout, so no ports are bound and no temporary files are created. A hard
 * timeout guarantees a hung engine cannot hang an HTTP request.
 */
export async function runPythonEngine(input: PythonEngineInput): Promise<EngineRunResult> {
  const target = cliPath();
  const payload = JSON.stringify(input);

  return new Promise<EngineRunResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.analysisEngine.executable, [target], {
        cwd: config.analysisEngine.root,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new PythonEngineUnavailableError('could not start the analysis engine process', {
          reason: 'spawn_failed',
          stderr: (error as Error).message,
        }),
      );
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL');
        reject(
          new PythonEngineUnavailableError(
            `analysis engine exceeded ${config.analysisEngine.timeoutMs}ms`,
            { reason: 'timeout', stderr: stderr.slice(-500) },
          ),
        );
      });
    }, config.analysisEngine.timeoutMs);

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        const message =
          error.code === 'ENOENT'
            ? `Python executable "${config.analysisEngine.executable}" was not found. ` +
              'Set ANALYSIS_ENGINE_PYTHON to a valid interpreter.'
            : `analysis engine failed to start: ${error.message}`;
        reject(
          new PythonEngineUnavailableError(message, {
            reason: 'spawn_failed',
            stderr: error.message,
          }),
        );
      });
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });

    child.on('close', (code) => {
      finish(() => {
        const trimmed = stdout.trim();
        if (trimmed === '') {
          reject(
            new PythonEngineUnavailableError(
              `analysis engine produced no output (exit code ${code})`,
              { reason: 'crashed', stderr: stderr.slice(-500) },
            ),
          );
          return;
        }
        // Exit code 2 means the payload itself was rejected; the process still
        // prints a structured result, which is more useful than a raw error.
        try {
          resolve(coerceResult(JSON.parse(trimmed)));
        } catch (error) {
          if (error instanceof PythonEngineUnavailableError) {
            reject(
              new PythonEngineUnavailableError(error.message, {
                ...error.detail,
                stderr: stderr.slice(-500) || error.detail.stderr,
              }),
            );
            return;
          }
          reject(
            new PythonEngineUnavailableError(
              `analysis engine output was not valid JSON: ${(error as Error).message}`,
              { reason: 'bad_output', stderr: stderr.slice(-500) },
            ),
          );
        }
      });
    });

    child.stdin?.on('error', (error) => {
      log.debug('stdin write failed (engine likely exited early)', { reason: error.message });
    });
    child.stdin?.end(payload, 'utf8');
  });
}

/**
 * Cheap availability probe: imports the package and prints its version.
 * Cached for the process lifetime because it only answers "can we spawn it?".
 */
let cachedProbe: Promise<{ ok: boolean; detail?: string }> | null = null;

export function probePythonEngine(force = false): Promise<{ ok: boolean; detail?: string }> {
  if (force) cachedProbe = null;
  if (cachedProbe) return cachedProbe;

  cachedProbe = new Promise<{ ok: boolean; detail?: string }>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        config.analysisEngine.executable,
        ['-c', 'import nexora_analysis as m; print(m.__version__)'],
        {
          cwd: config.analysisEngine.root,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
    } catch (error) {
      resolve({ ok: false, detail: (error as Error).message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, detail: 'probe timed out' });
    }, Math.min(config.analysisEngine.timeoutMs, 10_000));

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, detail: error.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, detail: `nexora-analysis-engine ${stdout.trim()}` });
      else resolve({ ok: false, detail: stderr.trim().slice(-300) || `exit code ${code}` });
    });
  });

  return cachedProbe;
}
