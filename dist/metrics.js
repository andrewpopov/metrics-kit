"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetricsInternal = createMetricsInternal;
exports.createMetrics = createMetrics;
exports.createMetricsFromEnv = createMetricsFromEnv;
const client_1 = require("@prometheus-io/client");
const errors_1 = require("./errors");
const labels_1 = require("./labels");
const spend_1 = require("./spend");
const tasks_1 = require("./tasks");
const server_1 = require("./server");
const DEFAULT_LABEL_MAX = 64;
const REJECTED_NAME = 'app_metrics_rejected_label_total';
const BUILD_INFO_NAME = 'app_build_info';
const HISTOGRAM_SUFFIXES = ['_bucket', '_sum', '_count'];
const BUILT_IN_NAMES = [
    REJECTED_NAME,
    BUILD_INFO_NAME,
    ...Object.values(tasks_1.TASK_METRIC_NAMES),
    ...HISTOGRAM_SUFFIXES.map((suffix) => `${tasks_1.TASK_METRIC_NAMES.duration}${suffix}`),
    ...Object.values(spend_1.SPEND_METRIC_NAMES),
];
// The client cannot stop collectDefaultMetrics (see README), so a second collector set would
// double-run the interval, event-loop histogram and GC observer for the rest of the process.
let defaultMetricsStarted = false;
function noopMetrics(validate, labelMaxLength) {
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
        declareTask: (name, taskOpts) => (0, tasks_1.assertTaskDeclaration)(name, taskOpts, labelMaxLength),
        trackTask: (_name, fn) => fn(),
        declarePaidApi: spend_1.assertPaidApiDeclaration,
        recordPaidApiCall: noop,
    };
}
function validateDef(def, forbiddenLabels = []) {
    (0, labels_1.assertMetricName)(def.name);
    (0, labels_1.assertLabelNames)(def, forbiddenLabels);
    for (const [label, allowed] of Object.entries(def.labels)) {
        for (const value of allowed)
            (0, labels_1.assertLabelValue)(value, `${def.name}{${label}} value`);
    }
}
/** Every exposition name a metric of this kind emits; a histogram also owns its _bucket/_sum/_count series. */
function generatedNames(def, histogram) {
    return histogram ? [def.name, ...HISTOGRAM_SUFFIXES.map((suffix) => `${def.name}${suffix}`)] : [def.name];
}
class EnabledMetrics {
    constructor(opts, defaultPort, deps) {
        this.defaultPort = defaultPort;
        this.deps = deps;
        this.enabled = true;
        this.registry = new client_1.Registry();
        this.names = new Set();
        this.server = null;
        this.starting = null;
        this.closing = null;
        this.closed = false;
        const collectDefaults = opts.defaultMetrics ?? true;
        if (collectDefaults && defaultMetricsStarted) {
            throw new errors_1.MetricsConfigError('DEFAULT_METRICS_ACTIVE', 'default metrics are already collecting in this process and cannot be stopped; pass defaultMetrics: false');
        }
        this.labelMax = opts.labelValueMaxLength ?? DEFAULT_LABEL_MAX;
        const internal = {
            counter: (def) => this.createCounter(def, true),
            gauge: (def) => this.createGauge(def, true),
            histogram: (def) => this.createHistogram(def, true),
        };
        this.tasks = new tasks_1.Tasks(internal, this.labelMax);
        this.spend = new spend_1.Spend(internal);
        for (const name of [REJECTED_NAME, BUILD_INFO_NAME])
            this.names.add(name);
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
        }).set({ version: this.buildInfoValue('version', opts.version), commit: this.buildInfoValue('commit', opts.commit ?? 'unknown') }, 1);
        if (collectDefaults) {
            defaultMetricsStarted = true;
            (0, client_1.collectDefaultMetrics)({ register: this.registry });
        }
    }
    buildInfoValue(label, value) {
        if ((0, labels_1.isValidLabelValue)(value, this.labelMax))
            return value;
        this.rejected.inc({ metric: BUILD_INFO_NAME, label });
        return labels_1.OTHER;
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
        if (this.server || this.starting) {
            throw new errors_1.MetricsConfigError('PORT_IN_USE', `metrics already serving${this.server ? ` on port ${this.server.port}` : ''}`);
        }
        const port = opts.port ?? (this.defaultPort === undefined ? undefined : (0, server_1.parseStrictPort)(this.defaultPort));
        if (port === undefined)
            throw new errors_1.MetricsConfigError('INVALID_PORT', 'no metrics port: pass serve({ port }) or set METRICS_PORT');
        // Recorded synchronously, so a concurrent serve() or close() sees the startup in flight.
        const starting = this.start(port, opts.host ?? server_1.LOOPBACK_HOST);
        this.starting = starting;
        try {
            return await starting;
        }
        finally {
            this.starting = null;
        }
    }
    async start(port, host) {
        const server = await (0, server_1.listenMetrics)(() => this.render(), this.contentType, { port, host }, this.deps);
        if (this.closed) {
            await server.close();
            throw new errors_1.MetricsConfigError('ALREADY_CLOSED', 'metrics instance was closed while starting');
        }
        this.server = server;
        return server;
    }
    close() {
        return (this.closing ?? (this.closing = this.shutDown()));
    }
    async shutDown() {
        this.closed = true;
        await this.starting?.catch(() => undefined);
        const server = this.server;
        this.server = null;
        await server?.close();
        this.registry.clear();
    }
    counter(def) {
        return this.createCounter(def, false);
    }
    gauge(def) {
        return this.createGauge(def, false);
    }
    histogram(def) {
        return this.createHistogram(def, false);
    }
    createCounter(def, builtIn) {
        const metric = new client_1.Counter({ ...this.register(def, [], false, builtIn), registers: [this.registry] });
        return { inc: (labels, value) => metric.inc(this.clean(def, labels), value) };
    }
    createGauge(def, builtIn) {
        const metric = new client_1.Gauge({ ...this.register(def, [], false, builtIn), registers: [this.registry] });
        return {
            set: (labels, value) => metric.set(this.clean(def, labels), value),
            inc: (labels, value) => metric.inc(this.clean(def, labels), value),
        };
    }
    createHistogram(def, builtIn) {
        const metric = new client_1.Histogram({ ...this.register(def, ['le'], true, builtIn), buckets: [...def.buckets], registers: [this.registry] });
        return { observe: (labels, value) => metric.observe(this.clean(def, labels), value) };
    }
    declareTask(name, opts) {
        this.tasks.declare(name, opts);
    }
    trackTask(name, fn) {
        return this.tasks.track(name, fn);
    }
    declarePaidApi(opts) {
        this.spend.declare(opts);
    }
    recordPaidApiCall(e) {
        this.spend.record(e);
    }
    register(def, forbiddenLabels, histogram, builtIn) {
        validateDef(def, forbiddenLabels);
        const generated = generatedNames(def, histogram);
        for (const name of generated) {
            if (this.names.has(name) || (!builtIn && BUILT_IN_NAMES.includes(name))) {
                throw new errors_1.MetricsConfigError('INVALID_NAME', name === def.name ? `metric ${def.name} is already registered` : `metric ${def.name} would emit ${name}, which is already registered`);
            }
        }
        for (const name of generated)
            this.names.add(name);
        return { name: def.name, help: def.help, labelNames: Object.keys(def.labels) };
    }
    clean(def, labels) {
        return (0, labels_1.sanitizeLabels)(def, labels, this.labelMax, (label) => this.rejected.inc({ metric: def.name, label }));
    }
}
function createMetricsInternal(opts, rawPort, deps) {
    return opts.enabled ? new EnabledMetrics(opts, rawPort, deps) : noopMetrics(validateDef, opts.labelValueMaxLength ?? DEFAULT_LABEL_MAX);
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
