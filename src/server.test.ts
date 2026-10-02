import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createMetricsFromEnv, MetricsConfigError, type Metrics } from './index';
import { createMetricsInternal } from './metrics';

const open: Metrics[] = [];
const make = (rawPort?: string, deps = {}): Metrics => {
  const m = createMetricsInternal({ enabled: true, version: '1', defaultMetrics: false }, rawPort, deps);
  open.push(m);
  return m;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((m) => m.close()));
});

const request = (port: number, path: string, method = 'GET') =>
  new Promise<{ status: number; body: string; type?: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, type: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end();
  });

const ephemeral = { allowEphemeralPort: true };

describe('serve() refusals happen before any listener exists', () => {
  it.each(['0.0.0.0', '::', 'localhost', '127.0.0.2', '::1', '', '127.0.0.1 '])('refuses host %j', async (host) => {
    const m = make(undefined, ephemeral);
    await expect(m.serve({ port: 9511, host })).rejects.toMatchObject({ code: 'NON_LOOPBACK_HOST' });
  });

  it.each([Number.NaN, 0, 70000, 1.5, -1, Infinity])('refuses port %s', async (port) => {
    await expect(make().serve({ port })).rejects.toMatchObject({ code: 'INVALID_PORT' });
  });

  it.each(['abc', '95 00', '-1', '1.5', '0x10', '+9500', ' 9500', '9500 '])('parses METRICS_PORT %j strictly', async (raw) => {
    await expect(make(raw).serve()).rejects.toMatchObject({ code: 'INVALID_PORT' });
  });

  it.each(['0', '70000'])('refuses env port %s as out of range', async (raw) => {
    await expect(make(raw).serve()).rejects.toMatchObject({ code: 'INVALID_PORT' });
  });

  it('refuses in a cluster worker', async () => {
    await expect(make(undefined, { ...ephemeral, isWorker: true }).serve({ port: 0 })).rejects.toMatchObject({
      code: 'CLUSTER_WORKER',
    });
  });

  it('refuses after close()', async () => {
    const m = make(undefined, ephemeral);
    await m.close();
    await expect(m.serve({ port: 0 })).rejects.toMatchObject({ code: 'ALREADY_CLOSED' });
  });

  it('public serve() does not accept port 0', async () => {
    await expect(make().serve({ port: 0 })).rejects.toBeInstanceOf(MetricsConfigError);
  });

  it('refuses a second serve() on the same instance', async () => {
    const m = make(undefined, ephemeral);
    await m.serve({ port: 0 });
    await expect(m.serve({ port: 0 })).rejects.toMatchObject({ code: 'PORT_IN_USE' });
  });
});

const freePort = async (): Promise<number> => {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((r) => probe.close(r));
  return port;
};
const canBind = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

describe('serve()/close() races (finding 1)', () => {
  it('a concurrent second serve() is refused immediately and leaves exactly one listener', async () => {
    const m = make();
    const [a, b] = [await freePort(), await freePort()];
    const first = m.serve({ port: a });
    const second = m.serve({ port: b });
    await expect(second).rejects.toMatchObject({ code: 'PORT_IN_USE' });
    await first;
    await expect(request(b, '/metrics')).rejects.toThrow();
    expect((await request(a, '/metrics')).status).toBe(200);
  });

  it('close() during startup waits for it, closes the listener and frees the port; serve() rejects ALREADY_CLOSED', async () => {
    const m = make();
    const port = await freePort();
    const started = m.serve({ port });
    const outcome = started.then(() => 'resolved', (err: MetricsConfigError) => err.code);
    await m.close();
    expect(await outcome).toBe('ALREADY_CLOSED');
    expect(await canBind(port)).toBe(true);
  });

  it('close() called twice during startup is idempotent', async () => {
    const m = make();
    const port = await freePort();
    const started = m.serve({ port }).catch(() => undefined);
    await Promise.all([m.close(), m.close()]);
    await started;
    expect(await canBind(port)).toBe(true);
  });
});

describe('serve()', () => {
  it('serves /metrics over real HTTP on loopback with the content type', async () => {
    const m = make(undefined, ephemeral);
    const server = await m.serve({ port: 0 });
    expect(server?.host).toBe('127.0.0.1');
    expect(server?.boundAddress).toBe('127.0.0.1');
    const res = await request(server!.port, '/metrics');
    expect(res.status).toBe(200);
    expect(res.type).toBe(m.contentType);
    expect(res.body).toContain('app_build_info{version="1",commit="unknown"} 1');
    expect((await request(server!.port, '/metrics?x=1')).status).toBe(200);
  });

  it('returns 404 with an empty body for any other path', async () => {
    const server = await make(undefined, ephemeral).serve({ port: 0 });
    for (const path of ['/', '/metrics/', '/health', '/metricsx']) {
      expect(await request(server!.port, path)).toMatchObject({ status: 404, body: '' });
    }
  });

  it('returns 405 for non-GET', async () => {
    const server = await make(undefined, ephemeral).serve({ port: 0 });
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      expect((await request(server!.port, '/metrics', method)).status).toBe(405);
    }
  });

  it('uses the port read from METRICS_PORT by createMetricsFromEnv', async () => {
    const holder = net.createServer();
    await new Promise<void>((r) => holder.listen(0, '127.0.0.1', r));
    const busy = (holder.address() as net.AddressInfo).port;
    const m = createMetricsFromEnv({ version: '1', defaultMetrics: false }, { METRICS_PORT: String(busy) });
    open.push(m);
    await expect(m.serve()).rejects.toMatchObject({ code: 'PORT_IN_USE', message: expect.stringContaining(String(busy)) });
    await new Promise((r) => holder.close(r));
  });

  it('close() stops the listener and is idempotent', async () => {
    const m = make(undefined, ephemeral);
    const server = await m.serve({ port: 0 });
    const port = server!.port;
    await m.close();
    await m.close();
    await expect(request(port, '/metrics')).rejects.toThrow();
  });

  it('server.close() alone stops the listener', async () => {
    const server = await make(undefined, ephemeral).serve({ port: 0 });
    const port = server!.port;
    await server!.close();
    await expect(request(port, '/metrics')).rejects.toThrow();
  });
});
