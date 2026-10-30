# Changelog

## Unreleased

## 0.1.1

- Installing from git no longer runs a full dependency install: the `prepare` script is gone (run `npm run hooks` once after cloning) and `build` is now `compile`
  npm 11 runs a full `npm install` (devDependencies included) inside a git clone when package.json has a `prepare` or `build` script. `dist/` is committed, so neither is needed at install time.
- Update shared release notes tooling
  Refresh the shared release notes package pins and lockfiles. Full release verification and production rollout remain with the next release candidate.

## 0.1.0

- Framework-free core API (createMetrics, createMetricsFromEnv, bound counter/gauge/histogram, loopback-only serve) on @prometheus-io/client
  One Registry per instance, closed label values (`__other__` plus a rejected-label counter), reserved label names refused, and a loopback-only `/metrics` listener. Requires Node `^22 || ^24 || >=26`.
- Express adapter httpMetrics (@andrewpopov/metrics-kit/express) with declared-route HTTP RED metrics
  `httpMetrics(metrics, { routes, ignore })` records request duration and in-flight requests labelled by the declared route template (never raw paths), method and status class (`aborted` for clients that disconnect). Works with Express 4 and 5.
- Task heartbeats (declareTask/trackTask) and paid-API usage (declarePaidApi/recordPaidApiCall)
  Tasks emit runs, duration, running, last-success, declared and expected-interval series. Paid-API usage counts calls and disjoint units per billing provider and model, with estimated cost only for units that have a tariff. Every `MetricDef.labels` entry is an explicit `ReadonlySet<string>`; there is no unchecked label mode.
- Concurrency-safe serve()/close(), declared label values and task names refused when they could not export verbatim, generated-name collisions, one default-metrics instance per process
  `declareTask` and every declared label value refuse `|`, control characters and whitespace (and over-long task names) with `INVALID_ARGUMENT`; a second default-metrics instance in one process throws `DEFAULT_METRICS_ACTIVE`; `app_build_info` values that are too long or invalid become `__other__` (never truncated); histograms reserve `_bucket`/`_sum`/`_count` and the kit's `app_*` names are reserved. `serve()` refuses a concurrent second call and `close()` waits for a starting listener. `MetricsServer.boundAddress` reports the socket's real bound address; `close()` clears the registry.
