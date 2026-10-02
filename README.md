# metrics-kit

Fleet application metrics for Node services (`@prometheus-io/client`, the successor of the deprecated `prom-client`): declared-route HTTP RED, runtime, task heartbeats, paid-API usage — loopback-only exposure.

**Status: v0.1 in progress.** The framework-free core (`createMetrics`, `createMetricsFromEnv`, bound counter/gauge/histogram, loopback `serve()`) is implemented; tasks, paid-API usage and the Express adapter below are planned and will change.

Requires Node `^22 || ^24 || >=26` (the client library's own range).

### `close()` and default metrics

`close()` stops the HTTP server. `@prometheus-io/client` 0.16.1 offers no way to stop `collectDefaultMetrics`: its event-loop-utilization `setInterval` (unref'd), event-loop-delay histogram and GC `PerformanceObserver` keep running until process exit and keep the closed registry alive. They never hold the process open, but creating many default-metrics instances in one process leaks; pass `defaultMetrics: false` for short-lived instances (tests).

## Design

- One explicit `@prometheus-io/client` `Registry` per `createMetrics()`; the global registry is never used.
- `/metrics` is served on a separate loopback-only listener (literal `127.0.0.1`) on `METRICS_PORT`, and is inert when the variable is unset.
- Route labels come from declared templates matched by the kit, never from `req.baseUrl` or `req.route`.
- All label values come from declared sets or closed enums; unknown values become `__other__`. The label names `job`, `instance`, `app` and `host` are reserved.
- Tasks (not "jobs") emit heartbeat metrics.
- Paid-API usage is counted in units by billing provider.

## Planned API (not implemented)

```ts
import { createMetrics } from '@andrewpopov/metrics-kit';
import { metricsMiddleware } from '@andrewpopov/metrics-kit/express';

const metrics = createMetrics({
  app: 'myservice',
  routes: ['/users/:id', '/health'],   // declared templates
});

app.use(metricsMiddleware(metrics));   // HTTP RED by declared route
const task = metrics.task('nightly-sync');
await task.run(async () => { /* heartbeat: start, success/failure, duration */ });
metrics.paidApi('openai').add(1200);   // units by billing provider
await metrics.listen();                // loopback-only, needs METRICS_PORT
```

## Development

```bash
npm install
npm run verify
```

See `.agents/project-guidelines.md` and `RELEASING.md`.
