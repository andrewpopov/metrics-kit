"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tasks = exports.TASK_METRIC_NAMES = exports.TASK_DURATION_BUCKETS = void 0;
exports.assertTaskDeclaration = assertTaskDeclaration;
const errors_1 = require("./errors");
const labels_1 = require("./labels");
exports.TASK_DURATION_BUCKETS = [1, 5, 15, 60, 300, 900, 3600];
exports.TASK_METRIC_NAMES = {
    runs: 'app_task_runs_total',
    duration: 'app_task_duration_seconds',
    running: 'app_task_running',
    lastSuccess: 'app_task_last_success_timestamp_seconds',
    declared: 'app_task_declared_timestamp_seconds',
    expected: 'app_task_expected_interval_seconds',
};
/** Task state is keyed by name, so a name must export verbatim: one that would be coerced to `__other__` could share a series. */
function assertTaskDeclaration(name, opts, labelMaxLength) {
    if (typeof name !== 'string' || name === '') {
        throw new errors_1.MetricsConfigError('INVALID_ARGUMENT', 'task name must be a non-empty string');
    }
    (0, labels_1.assertLabelValue)(name, 'task name', labelMaxLength);
    if (!Number.isFinite(opts.expectedEverySeconds) || opts.expectedEverySeconds <= 0) {
        throw new errors_1.MetricsConfigError('INVALID_ARGUMENT', `task ${name}: expectedEverySeconds must be a finite number > 0`);
    }
    if (opts.lastSuccessAt !== undefined && !Number.isFinite(toEpochMs(opts.lastSuccessAt))) {
        throw new errors_1.MetricsConfigError('INVALID_ARGUMENT', `task ${name}: lastSuccessAt must be a valid Date or epoch ms`);
    }
}
function toEpochMs(at) {
    return at instanceof Date ? at.getTime() : at;
}
/**
 * Scheduled-work heartbeats. Metric families are created on the first declaration and
 * share one mutable `task` value set, so tasks can be declared at any time before use.
 */
class Tasks {
    constructor(metrics, labelMaxLength) {
        this.metrics = metrics;
        this.labelMaxLength = labelMaxLength;
        this.names = new Set();
        this.lastSuccessMs = new Map();
        this.families = null;
    }
    declare(name, opts) {
        assertTaskDeclaration(name, opts, this.labelMaxLength);
        if (this.names.has(name))
            throw new errors_1.MetricsConfigError('DUPLICATE_DECLARATION', `task ${name} is already declared`);
        const f = (this.families ?? (this.families = this.createFamilies()));
        this.names.add(name);
        const labels = { task: name };
        f.declared.set(labels, Date.now() / 1000);
        f.expected.set(labels, opts.expectedEverySeconds);
        f.running.set(labels, 0);
        if (opts.lastSuccessAt !== undefined)
            this.recordSuccess(f, name, toEpochMs(opts.lastSuccessAt));
    }
    async track(name, fn) {
        const f = this.families;
        if (!f || !this.names.has(name))
            throw new errors_1.MetricsConfigError('UNDECLARED_TASK', `task ${name} is not declared`);
        const labels = { task: name };
        const started = performance.now();
        f.running.inc(labels, 1);
        try {
            const result = await fn();
            f.runs.inc({ task: name, outcome: 'success' });
            this.recordSuccess(f, name, Date.now());
            return result;
        }
        catch (err) {
            f.runs.inc({ task: name, outcome: 'failure' });
            throw err;
        }
        finally {
            f.duration.observe(labels, (performance.now() - started) / 1000);
            f.running.inc(labels, -1);
        }
    }
    recordSuccess(f, name, ms) {
        const best = Math.max(ms, this.lastSuccessMs.get(name) ?? -Infinity);
        this.lastSuccessMs.set(name, best);
        f.lastSuccess.set({ task: name }, best / 1000);
    }
    createFamilies() {
        const task = this.names;
        const outcome = new Set(['success', 'failure']);
        return {
            runs: this.metrics.counter({ name: exports.TASK_METRIC_NAMES.runs, help: 'Task invocations by outcome.', labels: { task, outcome } }),
            duration: this.metrics.histogram({
                name: exports.TASK_METRIC_NAMES.duration,
                help: 'Task invocation duration.',
                labels: { task },
                buckets: exports.TASK_DURATION_BUCKETS,
            }),
            running: this.metrics.gauge({ name: exports.TASK_METRIC_NAMES.running, help: 'Task invocations currently running.', labels: { task } }),
            lastSuccess: this.metrics.gauge({
                name: exports.TASK_METRIC_NAMES.lastSuccess,
                help: 'Completion time of the latest successful invocation; absent until one succeeds.',
                labels: { task },
            }),
            declared: this.metrics.gauge({ name: exports.TASK_METRIC_NAMES.declared, help: 'When the task was declared.', labels: { task } }),
            expected: this.metrics.gauge({
                name: exports.TASK_METRIC_NAMES.expected,
                help: 'Declared expected seconds between successful runs.',
                labels: { task },
            }),
        };
    }
}
exports.Tasks = Tasks;
