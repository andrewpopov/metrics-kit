"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpMetrics = httpMetrics;
const routes_1 = require("./routes");
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];
const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx', 'aborted'];
const PASS_THROUGH = (_req, _res, next) => next();
const statusClass = (code) => (code >= 100 && code < 600 ? `${Math.floor(code / 100)}xx` : 'aborted');
function pathOf(url) {
    const end = url.search(/[?#]/);
    return end === -1 ? url : url.slice(0, end);
}
/** Mount first: `app.use(httpMetrics(metrics, { routes: [...] }))`. */
function httpMetrics(metrics, opts) {
    const table = new routes_1.RouteTable(opts.routes);
    const ignore = [...(opts.ignore ?? [])];
    const duration = metrics.histogram({
        name: 'http_server_request_duration_seconds',
        help: 'HTTP server request duration by method, declared route template and status class.',
        labels: {
            method: new Set(routes_1.METHODS),
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
    if (!metrics.enabled)
        return PASS_THROUGH;
    return (req, res, next) => {
        const url = req.originalUrl;
        const path = pathOf(url);
        if (ignore.some((prefix) => path.startsWith(prefix)))
            return next();
        const start = process.hrtime.bigint();
        const route = table.match(req.method, url);
        let done = false;
        const finish = (status) => {
            if (done)
                return;
            done = true;
            inFlight.inc({}, -1);
            duration.observe({ method: req.method, route, status_class: status }, Number(process.hrtime.bigint() - start) / 1e9);
        };
        const onFinish = () => finish(statusClass(res.statusCode));
        const onClose = () => finish('aborted');
        inFlight.inc({}, 1);
        res.on('finish', onFinish);
        res.on('close', onClose);
        next();
    };
}
