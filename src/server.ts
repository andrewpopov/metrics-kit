import cluster from 'node:cluster';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MetricsConfigError } from './errors';
import type { MetricsServer } from './types';

export const LOOPBACK_HOST = '127.0.0.1';

export interface ListenDeps {
  isWorker?: boolean;
  /** Test-only: permits port 0 (OS-assigned). Never reachable from the public API. */
  allowEphemeralPort?: boolean;
}

export function parseStrictPort(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new MetricsConfigError('INVALID_PORT', `METRICS_PORT must be digits only, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

function assertPort(port: number, allowZero: boolean): void {
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < min || port > 65535) {
    throw new MetricsConfigError('INVALID_PORT', `metrics port must be an integer ${min}..65535, got ${String(port)}`);
  }
}

/** Validates everything before any listener exists, then listens. */
export async function listenMetrics(
  render: () => Promise<string>,
  contentType: string,
  target: { port: number; host: string },
  deps: ListenDeps,
): Promise<MetricsServer> {
  if (deps.isWorker ?? cluster.isWorker) {
    throw new MetricsConfigError('CLUSTER_WORKER', 'metrics must not be served from a cluster worker; serve from the primary');
  }
  if (target.host !== LOOPBACK_HOST) {
    throw new MetricsConfigError('NON_LOOPBACK_HOST', `metrics host must be exactly ${LOOPBACK_HOST}, got ${JSON.stringify(target.host)}`);
  }
  assertPort(target.port, deps.allowEphemeralPort === true);

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    if (req.url?.split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    render().then(
      (body) => res.writeHead(200, { 'Content-Type': contentType }).end(body),
      () => res.writeHead(500).end(),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new MetricsConfigError('PORT_IN_USE', `metrics port ${target.port} is already in use`)
          : err,
      );
    });
    server.listen(target.port, target.host, resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    host: target.host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
