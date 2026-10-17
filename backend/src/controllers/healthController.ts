import type { Request, Response } from 'express';
import { SERVICE_NAME, SERVICE_VERSION, config } from '../config/env.js';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { success } from '../lib/respond.js';
import type { HealthPayload } from '../types/api.js';
import { probePythonEngine } from '../services/analysis/pythonEngine.js';

/**
 * `GET /api/health`
 *
 * Reports the state of each subsystem rather than a bare 200, because "is the
 * market-data provider reachable?" is the question operators actually have.
 * The endpoint stays 200 even when degraded so probes can read the body; the
 * `status` field carries the verdict.
 */
export function createHealthController(container: Container) {
  return {
    get: asyncHandler(async (_req: Request, res: Response) => {
      const [engine, marketData, storage] = await Promise.all([
        probePythonEngine(),
        container.marketData.health(),
        container.storage.health(),
      ]);

      const payload: HealthPayload = {
        status: engine.ok && storage.ok ? 'ok' : 'degraded',
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        environment: config.nodeEnv,
        checks: {
          api: 'ok',
          analysisEngine: {
            status: engine.ok ? 'available' : 'unavailable',
            executable: config.analysisEngine.executable,
            id: engine.ok ? 'python' : 'typescript-fallback',
            ...(engine.detail ? { detail: engine.detail } : {}),
          },
          marketData: {
            provider: container.marketData.providerInfo.id,
            mode: container.marketData.providerInfo.mode,
            ...(marketData.detail ? { detail: marketData.detail } : {}),
          },
          storage: {
            driver: container.storage.description.driver,
            persistent: container.storage.description.persistent,
            ...(storage.detail ? { detail: storage.detail } : {}),
          },
        },
      };

      res.status(200).json(success(payload));
    }),
  };
}
