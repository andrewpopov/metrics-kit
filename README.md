# metrics-kit

Fleet application metrics for Node services (`@prometheus-io/client`, the successor of the deprecated `prom-client`): declared-route HTTP RED, runtime, task heartbeats, paid-API usage — loopback-only exposure.

**Status: v0.1 in progress.** The framework-free core (`createMetrics`, `createMetricsFromEnv`, bound counter/gauge/histogram, loopback `serve()`), task heartbeats and paid-API usage are implemented; the Express adapter below is planned and will change.

Requires Node `^22 || ^24 || >=26` (the client library's own range).

### `close()` and default metrics

`close()` stops the HTTP server. `@prometheus-io/client` 0.16.1 offers no way to stop `collectDefaultMetrics`: its event-loop-utilization `setInterval` (unref'd), event-loop-delay histogram and GC `PerformanceObserver` keep running until process exit and keep the closed registry alive. They never hold the process open, but creating many default-metrics instances in one process leaks; pass `defaultMetrics: false` for short-lived instances (tests).

## Design

- One explicit `@prometheus-io/client` `Registry` per `createMetrics()`; the global registry is never used.
- `/metrics` is served on a separate loopback-only listener (literal `127.0.0.1`) on `METRICS_PORT`, and is inert when the variable is unset.
- Route labels come from declared templates matched by the kit, never from `req.baseUrl` or `req.route`.
- Every label declares an explicit value set (closed enums included); unknown values become `__other__`. The label names `job`, `instance`, `app` and `host` are reserved.
- Tasks (not "jobs") emit heartbeat metrics.
- Paid-API usage is counted in units by billing provider.

## Tasks

```ts
metrics.declareTask('nightly-sync', { expectedEverySeconds: 86_400, lastSuccessAt: restoredFromDb }); // lastSuccessAt optional
await metrics.trackTask('nightly-sync', async () => { /* work; errors are rethrown unchanged */ });
```

Emits `app_task_runs_total{task,outcome}`, `app_task_duration_seconds{task}`, `app_task_running{task}`, `app_task_last_success_timestamp_seconds{task}`, `app_task_declared_timestamp_seconds{task}` and `app_task_expected_interval_seconds{task}`. `last_success` is set only when an invocation completes successfully, never moves backwards, and is absent until the first success (unless seeded with `lastSuccessAt`). Tracking an undeclared task throws `UNDECLARED_TASK`. A disabled instance validates declarations and just runs the function.

## Paid-API usage (estimates)

```ts
metrics.declarePaidApi({
  provider: 'openai', // the BILLING vendor
  models: ['gpt-x'],
  tariffs: { 'gpt-x': { input_uncached: 0.000002, input_cache_read: 0.0000005, output: 0.00001 } }, // USD per unit
});
metrics.recordPaidApiCall({ provider: 'openai', model: 'gpt-x', outcome: 'success', units: { input_uncached: 900, input_cache_read: 100, output: 250 } });
```

Emits `app_paid_api_calls_total`, `app_paid_api_units_total`, `app_paid_api_cost_usd_total` and `app_paid_api_unpriced_units_total`. **Cost is an estimate** from the tariffs you declare, not a bill. Only units with a tariff add to cost; the rest go to `unpriced_units_total`, so unknown pricing is visible and never shown as $0. Negative or non-finite values are ignored and counted in `app_metrics_invalid_value_total{metric}`.

Units are **disjoint** (`input_uncached`, `input_cache_read`, `input_cache_write`, `output`, `requests`); map your vendor's usage into them yourself:

- OpenAI: `cached_tokens` is a *subset* of `prompt_tokens`, so `input_uncached = prompt_tokens - cached_tokens`, `input_cache_read = cached_tokens`, `output = completion_tokens`.
- Anthropic: cache usage is *separate* from `input_tokens`, so `input_uncached = input_tokens`, `input_cache_read = cache_read_input_tokens`, `input_cache_write = cache_creation_input_tokens`, `output = output_tokens`.

## Planned API (not implemented)

```ts
import { createMetrics } from '@andrewpopov/metrics-kit';
import { metricsMiddleware } from '@andrewpopov/metrics-kit/express';

const metrics = createMetrics({
  app: 'myservice',
  routes: ['/users/:id', '/health'],   // declared templates
});

app.use(metricsMiddleware(metrics));   // HTTP RED by declared route
await metrics.listen();                // loopback-only, needs METRICS_PORT
```

## Development

```bash
npm install
npm run verify
```

See `.agents/project-guidelines.md` and `RELEASING.md`.
