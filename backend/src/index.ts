import { SERVICE_NAME, SERVICE_VERSION, config } from './config/env.js';
import { createApp } from './app.js';
import { createContainer } from './container.js';
import { createLogger } from './lib/logger.js';
import { probePythonEngine } from './services/analysis/pythonEngine.js';

const log = createLogger('bootstrap');

async function main(): Promise<void> {
  const container = await createContainer();
  const app = createApp(container);

  const server = app.listen(config.port, () => {
    // Report the port that was actually bound. `PORT=0` asks the OS for any free
    // port, and logging the requested value would then be misleading.
    const address = server.address();
    const boundPort =
      typeof address === 'object' && address !== null ? address.port : config.port;

    log.info(`${SERVICE_NAME} ${SERVICE_VERSION} listening`, {
      url: `http://localhost:${boundPort}`,
      port: boundPort,
      environment: config.nodeEnv,
      marketData: `${container.marketData.providerInfo.id} (${container.marketData.providerInfo.mode})`,
      storage: `${container.storage.description.driver} (persistent: ${String(container.storage.description.persistent)})`,
    });
  });

  // Report engine availability once at boot so a misconfigured interpreter is
  // obvious immediately rather than on the first analysis request.
  const engine = await probePythonEngine();
  if (engine.ok) {
    log.info('Analysis engine ready', { detail: engine.detail });
  } else {
    log.warn('Analysis engine unavailable; analyses will use the configured fallback', {
      executable: config.analysisEngine.executable,
      fallbackEnabled: config.analysisEngine.allowTypeScriptFallback,
      detail: engine.detail,
    });
  }

  const shutdown = (signal: string): void => {
    log.info('Shutting down', { signal });
    container.marketData.dispose();
    server.close(() => {
      void container.storage.close().finally(() => process.exit(0));
    });
    // Never hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    // An uncaught exception leaves the process in an unknown state; log and exit
    // so the supervisor can restart cleanly.
    log.error('Uncaught exception', { reason: error.message, stack: error.stack });
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  log.error('Failed to start', {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
