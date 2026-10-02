import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express5 from 'express';
// @ts-expect-error -- the express4 npm alias ships no types
import express4Raw from 'express4';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createMetrics, MetricsConfigError, type Metrics } from '../index';
import { httpMetrics, type HttpMetricsOptions } from './index';

// Cast once to the v5 typings' shape.
const express4 = express4Raw as unknown as typeof express5;

const open: Metrics[] = [];
const servers: Server[] = [];
const make = (enabled = true): Metrics => {
  const m = createMetrics({ enabled, version: '1', defaultMetrics: false });
  open.push(m);
  return m;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((m) => m.close()));
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof MetricsConfigError ? err.code : `other:${String(err)}`;
  }
  return undefined;
};
const durationRows = (text: string): string[] =>
  text.split('\n').filter((l) => l.startsWith('http_server_request_duration_seconds_count'));
const count = (text: string, route: string, status: string, method = 'GET'): number => {
  const row = durationRows(text).find((l) => l.includes(`method="${method}"`) && l.includes(`route="${route}"`) && l.includes(`status_class="${status}"`));
  return row === undefined ? 0 : Number(row.split(' ').pop());
};
const totalCount = (text: string): number => durationRows(text).reduce((n, l) => n + Number(l.split(' ').pop()), 0);
const inFlight = (text: string): number => Number(text.split('\n').find((l) => l.startsWith('http_server_requests_in_flight '))?.split(' ')[1]);
const listen = async (app: http.RequestListener): Promise<number> => {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
};
const until = async (fn: () => Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not reached');
};

describe.each([
  ['express 5', express5],
  ['express 4', express4],
])('httpMetrics on %s', (_name, express) => {
  const setup = (opts: HttpMetricsOptions, enabled = true) => {
    const metrics = make(enabled);
    const app = express();
    app.use(httpMetrics(metrics, opts));
    return { metrics, app };
  };

  it('labels a parameterised mount by its declared template and never leaks the value', async () => {
    const { metrics, app } = setup({ routes: ['GET /reset/:token/confirm'] });
    const router = express.Router();
    router.get('/confirm', (_req, res) => void res.send('ok'));
    app.use('/reset/:token', router);
    await request(app).get('/reset/SECRET-abc123/confirm?x=SECRET-q');
    const text = await metrics.render();
    expect(count(text, '/reset/:token/confirm', '2xx')).toBe(1);
    expect(text).not.toContain('SECRET');
  });

  it('records an undeclared path as __unmatched__ without the value', async () => {
    const { metrics, app } = setup({ routes: ['GET /known'] });
    await request(app).get('/x/SECRET-zzz');
    const text = await metrics.render();
    expect(count(text, '__unmatched__', '4xx')).toBe(1);
    expect(text).not.toContain('SECRET');
  });

  it('templates nested routers and mounted sub-apps', async () => {
    const { metrics, app } = setup({ routes: ['GET /a/:x/b/:y/c', 'GET /sub/things/:id'] });
    const l1 = express.Router();
    const l2 = express.Router({ mergeParams: true });
    const l3 = express.Router({ mergeParams: true });
    l3.get('/c', (_req, res) => void res.send('c'));
    l2.use('/b/:y', l3);
    l1.use('/:x', l2);
    app.use('/a', l1);
    const sub = express();
    sub.get('/things/:id', (_req, res) => void res.send('t'));
    app.use('/sub', sub);
    await request(app).get('/a/1/b/2/c');
    await request(app).get('/sub/things/9');
    const text = await metrics.render();
    expect(count(text, '/a/:x/b/:y/c', '2xx')).toBe(1);
    expect(count(text, '/sub/things/:id', '2xx')).toBe(1);
  });

  it('matches regex and array Express routes by declaration, not by Express', async () => {
    const { metrics, app } = setup({ routes: ['GET /re/:n', 'GET /a', 'GET /b'] });
    app.get(/^\/re\/\d+$/, (_req, res) => void res.send('re'));
    app.get(['/a', '/b'], (_req, res) => void res.send('ab'));
    await request(app).get('/re/42');
    await request(app).get('/a');
    await request(app).get('/b');
    const text = await metrics.render();
    expect(count(text, '/re/:n', '2xx')).toBe(1);
    expect(count(text, '/a', '2xx')).toBe(1);
    expect(count(text, '/b', '2xx')).toBe(1);
  });

  it('observes once across next("route") and fallthrough', async () => {
    const { metrics, app } = setup({ routes: ['GET /ft'] });
    app.get('/ft', (_req, _res, next) => next('route'));
    app.get('/ft', (_req, res) => void res.send('second'));
    await request(app).get('/ft');
    const text = await metrics.render();
    expect(totalCount(text)).toBe(1);
    expect(count(text, '/ft', '2xx')).toBe(1);
  });

  it('labels the final-handler 404 of a declared path by its template', async () => {
    const { metrics, app } = setup({ routes: ['GET /nobody'] });
    await request(app).get('/nobody').expect(404);
    expect(count(await metrics.render(), '/nobody', '4xx')).toBe(1);
  });

  it('labels pre-route failures (body-parser 413, auth 401) by template', async () => {
    const { metrics, app } = setup({ routes: ['POST /upload', 'GET /private'] });
    app.use(express.json({ limit: '10b' }));
    app.use((req, res, next) => (req.path === '/private' ? void res.status(401).end() : next()));
    app.post('/upload', (_req, res) => void res.send('ok'));
    await request(app).post('/upload').send({ big: 'x'.repeat(100) }).expect(413);
    await request(app).get('/private').expect(401);
    const text = await metrics.render();
    expect(count(text, '/upload', '4xx', 'POST')).toBe(1);
    expect(count(text, '/private', '4xx')).toBe(1);
  });

  it('records a handler error answered by outer error middleware as one 5xx', async () => {
    const { metrics, app } = setup({ routes: ['GET /boom'] });
    const router = express.Router();
    router.get('/boom', () => {
      throw new Error('nope');
    });
    app.use(router);
    app.use((_err: unknown, _req: express5.Request, res: express5.Response, _next: express5.NextFunction) => void res.status(500).send('err'));
    await request(app).get('/boom').expect(500);
    const text = await metrics.render();
    expect(totalCount(text)).toBe(1);
    expect(count(text, '/boom', '5xx')).toBe(1);
  });

  it('records a client that destroys the socket mid-response as aborted, and returns in_flight to 0', async () => {
    const { metrics, app } = setup({ routes: ['GET /slow'] });
    app.get('/slow', (_req, res) => void setTimeout(() => res.send('late'), 300));
    const port = await listen(app);
    await new Promise<void>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/slow' });
      req.on('error', () => undefined);
      setTimeout(() => (req.destroy(), resolve()), 50);
    });
    await until(async () => count(await metrics.render(), '/slow', 'aborted') === 1);
    await new Promise((r) => setTimeout(r, 400));
    const text = await metrics.render();
    expect(count(text, '/slow', 'aborted')).toBe(1);
    expect(count(text, '/slow', '2xx')).toBe(0);
    expect(totalCount(text)).toBe(1);
    expect(inFlight(text)).toBe(0);
  });

  it('records exactly once when a response both finishes and closes', async () => {
    const { metrics, app } = setup({ routes: ['GET /once'] });
    app.get('/once', (_req, res) => void res.send('ok'));
    const port = await listen(app);
    await new Promise<void>((resolve) => http.get({ host: '127.0.0.1', port, path: '/once' }, (r) => (r.resume(), r.on('close', resolve))));
    await new Promise((r) => setTimeout(r, 50));
    const text = await metrics.render();
    expect(totalCount(text)).toBe(1);
    expect(count(text, '/once', '2xx')).toBe(1);
    expect(inFlight(text)).toBe(0);
  });

  it('the most specific declaration wins', async () => {
    const { metrics, app } = setup({ routes: ['GET /items/:id', 'GET /items/new', '* /items/*', 'GET /items/:id/*'] });
    app.get('/items/new', (_req, res) => void res.send('n'));
    app.get('/items/:id', (_req, res) => void res.send('i'));
    await request(app).get('/items/new');
    await request(app).get('/items/7');
    await request(app).post('/items/7');
    await request(app).get('/items/7/deep/er');
    const text = await metrics.render();
    expect(count(text, '/items/new', '2xx')).toBe(1);
    expect(count(text, '/items/:id', '2xx')).toBe(1);
    expect(count(text, '/items/*', '4xx', 'POST')).toBe(1);
    expect(count(text, '/items/:id/*', '4xx')).toBe(1);
  });

  it('matches * declarations for any method and maps unknown methods to __other__', async () => {
    const { metrics, app } = setup({ routes: ['* /m', 'GET /m'] });
    app.all('/m', (_req, res) => void res.send('m'));
    const port = await listen(app);
    await request(app).get('/m');
    await request(app).post('/m');
    await new Promise<void>((r) => http.request({ host: '127.0.0.1', port, method: 'PROPFIND', path: '/m' }, (x) => (x.resume(), x.on('end', r))).end());
    const text = await metrics.render();
    expect(count(text, '/m', '2xx', 'GET')).toBe(1);
    expect(count(text, '/m', '2xx', 'POST')).toBe(1);
    expect(count(text, '/m', '2xx', '__other__')).toBe(1);
    expect(text).toContain('method="__other__",route="/m"');
  });

  it('refuses bad declarations by name', () => {
    const bad = (routes: string[]) => codeOf(() => httpMetrics(createMetrics({ enabled: true, version: '1', defaultMetrics: false }), { routes }));
    for (const entry of ['FETCH /x', '/x', 'GET x', 'GET /a/*/b', 'GET /a?b=1', 'GET /a/(\\d+)', 'GET /a/b+', 'GET /a/', 'GET /a//b', 'GET /a*', 'GET /:', 'GET /a:b', 'GET /a b', 'GET /a\u0001b', 'GET /a\u007fb']) {
      expect(bad([entry]), entry).toBe('INVALID_ARGUMENT');
    }
    expect(bad(['GET /a', 'GET /a'])).toBe('INVALID_ARGUMENT');
    expect(bad(Array.from({ length: 201 }, (_, i) => `GET /r${i}`))).toBe('INVALID_ARGUMENT');
    expect(bad(Array.from({ length: 200 }, (_, i) => `GET /r${i}`))).toBeUndefined();
    expect(bad(['GET /', '* /x/:id', 'HEAD /y/*'])).toBeUndefined();
  });

  it('names the offending entry in the error message', () => {
    expect(() => httpMetrics(make(), { routes: ['GET /ok', 'FETCH /bad'] })).toThrow(/FETCH \/bad/);
  });

  it('does not measure ignored prefixes', async () => {
    const { metrics, app } = setup({ routes: ['GET /real'], ignore: ['/healthz'] });
    app.get('/healthz', (_req, res) => void res.send('ok'));
    app.get('/real', (_req, res) => void res.send('ok'));
    await request(app).get('/healthz');
    const text = await metrics.render();
    expect(durationRows(text)).toEqual([]);
    expect(text).not.toContain('healthz');
    await request(app).get('/real');
    expect(totalCount(await metrics.render())).toBe(1);
  });

  it('is a pure pass-through when metrics are disabled', async () => {
    const { app } = setup({ routes: ['GET /x'] }, false);
    let delta = -1;
    app.use((req, res, next) => {
      const before = res.listenerCount('finish');
      httpMetrics(make(false), { routes: ['GET /x'] })(req, res, () => {
        delta = res.listenerCount('finish') - before;
        next();
      });
    });
    app.get('/x', (_req, res) => void res.send('ok'));
    await request(app).get('/x').expect(200);
    expect(delta).toBe(0);
  });

  it('uses the exact histogram buckets', async () => {
    const { metrics, app } = setup({ routes: ['GET /b'] });
    app.get('/b', (_req, res) => void res.send('ok'));
    await request(app).get('/b');
    const text = await metrics.render();
    const les = text.split('\n').filter((l) => l.startsWith('http_server_request_duration_seconds_bucket')).map((l) => /le="([^"]+)"/.exec(l)?.[1]);
    expect(les).toEqual(['0.025', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '+Inf']);
  });
});
