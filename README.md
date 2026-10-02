# metrics-kit

Fleet application metrics for Node services (prom-client): declared-route HTTP RED, runtime, task heartbeats, paid-API usage — loopback-only exposure.

**Status: v0.1 in progress.** Only the package scaffold exists; the API below is planned and will change.

## Design

- One explicit prom-client `Registry` per `createMetrics()`; the global registry is never used.
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
