import { MetricsConfigError } from './errors';
import type { MetricDef } from './types';

export const OTHER = '__other__';
const RESERVED_LABELS = new Set(['job', 'instance', 'app', 'host']);
const NAME_RE = /^[a-z_][a-z0-9_]*$/;
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function assertMetricName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new MetricsConfigError('INVALID_NAME', `metric name ${JSON.stringify(name)} must match ${NAME_RE}`);
  }
}

export function assertLabelNames(def: MetricDef, extraForbidden: readonly string[] = []): void {
  for (const label of Object.keys(def.labels)) {
    if (RESERVED_LABELS.has(label) || label.startsWith('__')) {
      throw new MetricsConfigError('RESERVED_LABEL', `label ${JSON.stringify(label)} on ${def.name} is reserved`);
    }
    if (!LABEL_NAME_RE.test(label) || extraForbidden.includes(label)) {
      throw new MetricsConfigError('INVALID_NAME', `label name ${JSON.stringify(label)} on ${def.name} is invalid`);
    }
  }
}

/**
 * Maps caller-supplied label values onto declared ones. Anything not in the
 * allowed set (or too long, or missing) becomes `__other__`; `onReject` is told
 * the label NAME only, never the rejected value.
 */
export function sanitizeLabels(
  def: MetricDef,
  input: Record<string, string>,
  maxLength: number,
  onReject: (label: string) => void,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [label, allowed] of Object.entries(def.labels)) {
    const value = input[label];
    const ok =
      typeof value === 'string' &&
      value.length <= maxLength &&
      (allowed === 'closed' || allowed.has(value));
    if (ok) {
      out[label] = value;
    } else {
      out[label] = OTHER;
      onReject(label);
    }
  }
  return out;
}
