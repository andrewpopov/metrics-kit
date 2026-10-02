---
kind: added
summary: Express adapter httpMetrics (@andrewpopov/metrics-kit/express) with declared-route HTTP RED metrics
---

`httpMetrics(metrics, { routes, ignore })` records request duration and in-flight requests labelled by the declared route template (never raw paths), method and status class (`aborted` for clients that disconnect). Works with Express 4 and 5.
