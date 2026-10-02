"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetricsInternal = createMetricsInternal;
exports.createMetrics = createMetrics;
exports.createMetricsFromEnv = createMetricsFromEnv;
const client_1 = require("@prometheus-io/client");
const errors_1 = require("./errors");
const labels_1 = require("./labels");
const server_1 = require("./server");
const DEFAULT_LABEL_MAX = 64;
const REJECTED_NAME = 'app_metrics_rejected_label_total';
const BUILD_INFO_NAME = 'app_build_info';
function noopMetrics(validate) {
    const noop = () => undefined;
    return {
        enabled: false,
        serve: async () => null,
        render: async () => '',
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        close: async () => undefined,
        counter: (def) => (validate(def), { inc: noop }),
        gauge: (def) => (validate(def), { set: noop, inc: noop }),
        histogram: (def) => (validate(def), { observe: noop }),
    };
}
function validateDef(def, forbiddenLabels = []) {
    (0, labels_1.assertMetricName)(def.name);
    (0, labels_1.assertLabelNames)(def, forbiddenLabels);
}
class EnabledMetrics {
    constructor(opts, defaultPort, deps) {
        this.defaultPort = defaultPort;
        this.deps = deps;
        this.enabled = true;
        this.registry = new client_1.Registry();
        this.names = new Set();
        this.server = null;
        this.closed = false;
        this.labelMax = opts.labelValueMaxLength ?? DEFAULT_LABEL_MAX;
        this.names.add(REJECTED_NAME).add(BUILD_INFO_NAME);
        this.rejected = new client_1.Counter({
            name: REJECTED_NAME,
            help: 'Label values rejected and recorded as __other__, by metric and label name.',
            labelNames: ['metric', 'label'],
            registers: [this.registry],
        });
        new client_1.Gauge({
            name: BUILD_INFO_NAME,
            help: 'Build information; value is always 1.',
            labelNames: ['version', 'commit'],
            registers: [this.registry],
        }).set({ version: opts.version.slice(0, this.labelMax), commit: (opts.commit ?? 'unknown').slice(0, this.labelMax) }, 1);
        if (opts.defaultMetrics ?? true)
            (0, client_1.collectDefaultMetrics)({ register: this.registry });
    }
    get contentType() {
        return this.registry.contentType;
    }
    render() {
        return this.registry.metrics();
    }
    async serve(opts = {}) {
        if (this.closed)
            throw new errors_1.MetricsConfigError('ALREADY_CLOSED', 'metrics instance is closed');
        if (this.server) {
            throw new errors_1.MetricsConfigError('PORT_IN_USE', `metrics already serving on port ${this.server.port}`);
        }
        const port = opts.port ?? (this.defaultPort === undefined ? undefined : (0, server_1.parseStrictPort)(this.defaultPort));
        if (port === undefined)
            throw new errors_1.MetricsConfigError('INVALID_PORT', 'no metrics port: pass serve({ port }) or set METRICS_PORT');
        const server = await (0, server_1.listenMetrics)(() => this.render(), this.contentType, { port, host: opts.host ?? server_1.LOOPBACK_HOST }, this.deps);
        this.server = server;
        return server;
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        const server = this.server;
        this.server = null;
        await server?.close();
    }
    counter(def) {
        const metric = new client_1.Counter({ ...this.register(def), registers: [this.registry] });
        return { inc: (labels, value) => metric.inc(this.clean(def, labels), value) };
    }
    gauge(def) {
        const metric = new client_1.Gauge({ ...this.register(def), registers: [this.registry] });
        return {
            set: (labels, value) => metric.set(this.clean(def, labels), value),
            inc: (labels, value) => metric.inc(this.clean(def, labels), value),
        };
    }
    histogram(def) {
        const metric = new client_1.Histogram({ ...this.register(def, ['le']), buckets: [...def.buckets], registers: [this.registry] });
        return { observe: (labels, value) => metric.observe(this.clean(def, labels), value) };
    }
    register(def, forbiddenLabels = []) {
        validateDef(def, forbiddenLabels);
        if (this.names.has(def.name)) {
            throw new errors_1.MetricsConfigError('INVALID_NAME', `metric ${def.name} is already registered`);
        }
        this.names.add(def.name);
        return { name: def.name, help: def.help, labelNames: Object.keys(def.labels) };
    }
    clean(def, labels) {
        return (0, labels_1.sanitizeLabels)(def, labels, this.labelMax, (label) => this.rejected.inc({ metric: def.name, label }));
    }
}
function createMetricsInternal(opts, rawPort, deps) {
    return opts.enabled ? new EnabledMetrics(opts, rawPort, deps) : noopMetrics(validateDef);
}
function createMetrics(opts) {
    return createMetricsInternal(opts, undefined, {});
}
function createMetricsFromEnv(opts, env = process.env) {
    const raw = env.METRICS_PORT;
    if (raw === undefined || raw === '')
        return createMetrics({ ...opts, enabled: false });
    // A bad METRICS_PORT is refused at serve(), before any listener exists.
    return createMetricsInternal({ ...opts, enabled: true }, raw, {});
}
