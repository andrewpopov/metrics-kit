---
kind: added
summary: Task heartbeats (declareTask/trackTask) and paid-API usage (declarePaidApi/recordPaidApiCall); the unchecked 'closed' label mode is removed
---

Tasks emit runs, duration, running, last-success, declared and expected-interval series. Paid-API usage counts calls and disjoint units per billing provider and model, with estimated cost only for units that have a tariff. Breaking: `MetricDef.labels` values must now be explicit `ReadonlySet<string>`; `'closed'` is gone.
