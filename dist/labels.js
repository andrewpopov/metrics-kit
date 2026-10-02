"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTHER = void 0;
exports.assertMetricName = assertMetricName;
exports.assertLabelNames = assertLabelNames;
exports.sanitizeLabels = sanitizeLabels;
const errors_1 = require("./errors");
exports.OTHER = '__other__';
const RESERVED_LABELS = new Set(['job', 'instance', 'app', 'host']);
const NAME_RE = /^[a-z_][a-z0-9_]*$/;
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function assertMetricName(name) {
    if (!NAME_RE.test(name)) {
        throw new errors_1.MetricsConfigError('INVALID_NAME', `metric name ${JSON.stringify(name)} must match ${NAME_RE}`);
    }
}
function assertLabelNames(def, extraForbidden = []) {
    for (const label of Object.keys(def.labels)) {
        if (RESERVED_LABELS.has(label) || label.startsWith('__')) {
            throw new errors_1.MetricsConfigError('RESERVED_LABEL', `label ${JSON.stringify(label)} on ${def.name} is reserved`);
        }
        if (!LABEL_NAME_RE.test(label) || extraForbidden.includes(label)) {
            throw new errors_1.MetricsConfigError('INVALID_NAME', `label name ${JSON.stringify(label)} on ${def.name} is invalid`);
        }
    }
}
/**
 * Maps caller-supplied label values onto declared ones. Anything not in the
 * allowed set (or too long, or missing) becomes `__other__`; `onReject` is told
 * the label NAME only, never the rejected value.
 */
function sanitizeLabels(def, input, maxLength, onReject) {
    const out = {};
    for (const [label, allowed] of Object.entries(def.labels)) {
        const value = input[label];
        if (typeof value === 'string' && value.length <= maxLength && allowed.has(value)) {
            out[label] = value;
        }
        else {
            out[label] = exports.OTHER;
            onReject(label);
        }
    }
    return out;
}
