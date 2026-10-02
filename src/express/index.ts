import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Metrics } from '../types';
import { METHODS, RouteTable } from './routes';

export interface HttpMetricsOptions {
  /** Declared routes, `<METHOD> <path>` (`:param` = one segment, final `*` = the rest), e.g. `GET /users/:id`. */
  routes: readonly string[];
  /** Path prefixes that are not measured at all, e.g. `/healthz`. */
  ignore?: readonly string[];
}

const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] as const;
const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx', 'aborted'] as const;
const PASS_THROUGH: RequestHandler = (_req, _res, next) => next();

const statusClass = (code: number): string => (code >= 100 && code < 600 ? `${Math.floor(code / 100)}xx` : 'aborted');

function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/** Mount first: `app.use(httpMetrics(metrics, { routes: [...] }))`. */
export function httpMetrics(metrics: Metrics, opts: HttpMetricsOptions): RequestHandler {
  const table = new RouteTable(opts.routes);
  const ignore = [...(opts.ignore ?? [])];
  const duration = metrics.histogram({
    name: 'http_server_request_duration_seconds',
    help: 'HTTP server request duration by method, declared route template and status class.',
    labels: {
      method: new Set(METHODS),
      route: table.templates,
      status_class: new Set(STATUS_CLASSES),
    },
    buckets: BUCKETS,
  });
  const inFlight = metrics.gauge({
    name: 'http_server_requests_in_flight',
    help: 'HTTP requests currently being served.',
    labels: {},
  });
  if (!metrics.enabled) return PASS_THROUGH;

  return (req: Request, res: Response, next: NextFunction): void => {
    const url = req.originalUrl;
    const path = pathOf(url);
    if (ignore.some((prefix) => path.startsWith(prefix))) return next();

    const start = process.hrtime.bigint();
    const route = table.match(req.method, url);
    let done = false;
    const finish = (status: string): void => {
      if (done) return;
      done = true;
      inFlight.inc({}, -1);
      duration.observe({ method: req.method, route, status_class: status }, Number(process.hrtime.bigint() - start) / 1e9);
    };
    const onFinish = (): void => finish(statusClass(res.statusCode));
    const onClose = (): void => finish('aborted');

    inFlight.inc({}, 1);
    res.on('finish', onFinish);
    res.on('close', onClose);
    next();
  };
}
