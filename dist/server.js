"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOOPBACK_HOST = void 0;
exports.parseStrictPort = parseStrictPort;
exports.listenMetrics = listenMetrics;
const node_cluster_1 = __importDefault(require("node:cluster"));
const node_http_1 = __importDefault(require("node:http"));
const errors_1 = require("./errors");
exports.LOOPBACK_HOST = '127.0.0.1';
function parseStrictPort(raw) {
    if (!/^\d+$/.test(raw))
        throw new errors_1.MetricsConfigError('INVALID_PORT', `METRICS_PORT must be digits only, got ${JSON.stringify(raw)}`);
    return Number(raw);
}
function assertPort(port, allowZero) {
    const min = allowZero ? 0 : 1;
    if (!Number.isInteger(port) || port < min || port > 65535) {
        throw new errors_1.MetricsConfigError('INVALID_PORT', `metrics port must be an integer ${min}..65535, got ${String(port)}`);
    }
}
/** Validates everything before any listener exists, then listens. */
async function listenMetrics(render, contentType, target, deps) {
    if (deps.isWorker ?? node_cluster_1.default.isWorker) {
        throw new errors_1.MetricsConfigError('CLUSTER_WORKER', 'metrics must not be served from a cluster worker; serve from the primary');
    }
    if (target.host !== exports.LOOPBACK_HOST) {
        throw new errors_1.MetricsConfigError('NON_LOOPBACK_HOST', `metrics host must be exactly ${exports.LOOPBACK_HOST}, got ${JSON.stringify(target.host)}`);
    }
    assertPort(target.port, deps.allowEphemeralPort === true);
    const server = node_http_1.default.createServer((req, res) => {
        if (req.method !== 'GET') {
            res.writeHead(405, { Allow: 'GET' }).end();
            return;
        }
        if (req.url?.split('?')[0] !== '/metrics') {
            res.writeHead(404).end();
            return;
        }
        render().then((body) => res.writeHead(200, { 'Content-Type': contentType }).end(body), () => res.writeHead(500).end());
    });
    await new Promise((resolve, reject) => {
        server.once('error', (err) => {
            reject(err.code === 'EADDRINUSE'
                ? new errors_1.MetricsConfigError('PORT_IN_USE', `metrics port ${target.port} is already in use`)
                : err);
        });
        server.listen(target.port, target.host, resolve);
    });
    const { port, address } = server.address();
    return {
        host: target.host,
        boundAddress: address,
        port,
        close: () => new Promise((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
        }),
    };
}
