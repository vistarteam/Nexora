import cors from 'cors';
import express, { type Express } from 'express';
import { SERVICE_NAME, SERVICE_VERSION, config } from './config/env.js';
import type { Container } from './container.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createApiRouter } from './routes/index.js';

/**
 * Build the Express application.
 *
 * Kept separate from `index.ts` (which owns the process lifecycle) so tests can
 * spin up an app with a stubbed container and no listening socket.
 */
export function createApp(container: Container): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin or non-browser clients send no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
          callback(null, true);
          return;
        }
        // Rejecting an unknown origin is not an error worth a 500.
        callback(null, false);
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'accept'],
      credentials: false,
      maxAge: 600,
    }),
  );

  // Candle payloads are small, but a 1 MB ceiling keeps a malformed client from
  // tying up memory.
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      data: {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        documentation: '/api/health, /api/markets, /api/market-data, /api/analysis, /api/watchlist, /api/history',
      },
    });
  });

  app.use('/api', createApiRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
