import type { RequestHandler } from 'express';
import type { Metrics } from '../types';
export interface HttpMetricsOptions {
    /** Declared routes, `<METHOD> <path>` (`:param` = one segment, final `*` = the rest), e.g. `GET /users/:id`. */
    routes: readonly string[];
    /** Path prefixes that are not measured at all, e.g. `/healthz`. */
    ignore?: readonly string[];
}
/** Mount first: `app.use(httpMetrics(metrics, { routes: [...] }))`. */
export declare function httpMetrics(metrics: Metrics, opts: HttpMetricsOptions): RequestHandler;
