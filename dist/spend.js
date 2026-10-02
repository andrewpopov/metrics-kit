"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Spend = exports.SPEND_METRIC_NAMES = exports.UNITS = void 0;
exports.assertPaidApiDeclaration = assertPaidApiDeclaration;
const errors_1 = require("./errors");
const labels_1 = require("./labels");
exports.UNITS = new Set([
    'input_uncached',
    'input_cache_read',
    'input_cache_write',
    'output',
    'requests',
]);
exports.SPEND_METRIC_NAMES = {
    calls: 'app_paid_api_calls_total',
    units: 'app_paid_api_units_total',
    cost: 'app_paid_api_cost_usd_total',
    unpriced: 'app_paid_api_unpriced_units_total',
    invalid: 'app_metrics_invalid_value_total',
};
const isUnit = (key) => exports.UNITS.has(key);
// Never a declared model name, so a model reported under the wrong provider is rejected like an unknown one.
const NOT_DECLARED = '';
function assertPaidApiDeclaration(opts) {
    const bad = (msg) => {
        throw new errors_1.MetricsConfigError('INVALID_ARGUMENT', `paid API ${JSON.stringify(opts.provider)}: ${msg}`);
    };
    if (typeof opts.provider !== 'string' || opts.provider === '')
        bad('provider must be a non-empty string');
    if (opts.models.length === 0 || opts.models.some((m) => typeof m !== 'string' || m === '')) {
        bad('models must be a non-empty list of non-empty strings');
    }
    (0, labels_1.assertLabelValue)(opts.provider, 'paid API provider');
    for (const model of opts.models)
        (0, labels_1.assertLabelValue)(model, `paid API ${JSON.stringify(opts.provider)} model`);
    for (const [model, prices] of Object.entries(opts.tariffs ?? {})) {
        if (!opts.models.includes(model))
            bad(`tariff for undeclared model ${JSON.stringify(model)}`);
        for (const [unit, price] of Object.entries(prices ?? {})) {
            if (!isUnit(unit))
                bad(`tariff for ${JSON.stringify(model)} has unknown unit ${JSON.stringify(unit)}`);
            if (typeof price !== 'number' || !Number.isFinite(price) || price < 0)
                bad(`tariff ${model}/${unit} must be a finite number >= 0`);
        }
    }
}
/** Paid-API usage by billing provider; cost is an estimate from caller-declared tariffs. */
class Spend {
    constructor(metrics) {
        this.metrics = metrics;
        this.providers = new Map();
        this.providerNames = new Set();
        this.modelNames = new Set();
        this.families = null;
    }
    declare(opts) {
        assertPaidApiDeclaration(opts);
        if (this.providers.has(opts.provider)) {
            throw new errors_1.MetricsConfigError('DUPLICATE_DECLARATION', `paid API ${opts.provider} is already declared`);
        }
        this.families ?? (this.families = this.createFamilies());
        this.providers.set(opts.provider, {
            models: new Set(opts.models),
            tariffs: new Map(Object.entries(opts.tariffs ?? {}).map(([model, prices]) => [model, { ...prices }])),
        });
        this.providerNames.add(opts.provider);
        for (const model of opts.models)
            this.modelNames.add(model);
    }
    record(e) {
        const f = this.families;
        if (!f)
            return;
        const declared = this.providers.get(e.provider);
        const model = declared?.models.has(e.model) ? e.model : NOT_DECLARED;
        const base = { provider: e.provider, model };
        f.calls.inc({ ...base, outcome: e.outcome });
        const tariff = declared?.tariffs.get(e.model);
        let cost = 0;
        let priced = false;
        for (const [unit, amount] of Object.entries(e.units ?? {})) {
            if (!isUnit(unit) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
                f.invalid.inc({ metric: exports.SPEND_METRIC_NAMES.units });
                continue;
            }
            f.units.inc({ ...base, unit }, amount);
            const price = tariff?.[unit];
            if (price === undefined) {
                f.unpriced.inc({ ...base, unit }, amount);
            }
            else {
                cost += amount * price;
                priced = true;
            }
        }
        if (priced)
            f.cost.inc(base, cost);
    }
    createFamilies() {
        const provider = this.providerNames;
        const model = this.modelNames;
        return {
            calls: this.metrics.counter({
                name: exports.SPEND_METRIC_NAMES.calls,
                help: 'Paid API calls by billing provider, model and outcome.',
                labels: { provider, model, outcome: new Set(['success', 'failure']) },
            }),
            units: this.metrics.counter({
                name: exports.SPEND_METRIC_NAMES.units,
                help: 'Paid API usage units (disjoint) by billing provider and model.',
                labels: { provider, model, unit: exports.UNITS },
            }),
            cost: this.metrics.counter({
                name: exports.SPEND_METRIC_NAMES.cost,
                help: 'Estimated USD cost, only from units that have a declared tariff.',
                labels: { provider, model },
            }),
            unpriced: this.metrics.counter({
                name: exports.SPEND_METRIC_NAMES.unpriced,
                help: 'Units with no declared tariff; their cost is unknown, not zero.',
                labels: { provider, model, unit: exports.UNITS },
            }),
            invalid: this.metrics.counter({
                name: exports.SPEND_METRIC_NAMES.invalid,
                help: 'Negative, non-finite or unknown-unit values that were ignored, by metric.',
                labels: { metric: new Set([exports.SPEND_METRIC_NAMES.units]) },
            }),
        };
    }
}
exports.Spend = Spend;
