---
kind: fixed
summary: Concurrency-safe serve()/close(), declared label values and task names refused when they could not export verbatim, generated-name collisions, one default-metrics instance per process
---

Breaking behaviour: `declareTask` and every declared label value now refuse `|`, control characters and whitespace (and over-long task names) with `INVALID_ARGUMENT`; a second default-metrics instance throws `DEFAULT_METRICS_ACTIVE`; `app_build_info` values that are too long or invalid become `__other__` instead of being truncated; histograms reserve `_bucket`/`_sum`/`_count` and the kit's `app_*` names are reserved. `serve()` refuses a concurrent second call and `close()` waits for a starting listener. `MetricsServer.boundAddress` reports the socket's real bound address; `close()` clears the registry.
