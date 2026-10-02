import type { MetricDef } from './types';
export declare const OTHER = "__other__";
export declare function assertMetricName(name: string): void;
export declare function assertLabelNames(def: MetricDef, extraForbidden?: readonly string[]): void;
/**
 * Maps caller-supplied label values onto declared ones. Anything not in the
 * allowed set (or too long, or missing) becomes `__other__`; `onReject` is told
 * the label NAME only, never the rejected value.
 */
export declare function sanitizeLabels(def: MetricDef, input: Record<string, string>, maxLength: number, onReject: (label: string) => void): Record<string, string>;
