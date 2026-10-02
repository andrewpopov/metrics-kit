---
kind: added
summary: Framework-free core API (createMetrics, createMetricsFromEnv, bound counter/gauge/histogram, loopback-only serve) on @prometheus-io/client
---

One Registry per instance, closed label values (`__other__` plus a rejected-label counter), reserved label names refused, and a loopback-only `/metrics` listener. Requires Node `^22 || ^24 || >=26`.
