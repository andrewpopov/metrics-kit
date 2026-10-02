import { MetricsConfigError } from './errors';
import type { BoundCounter, Metrics, PaidApiCall, PaidApiOptions, Unit } from './types';

export const UNITS: ReadonlySet<string> = new Set<Unit>([
  'input_uncached',
  'input_cache_read',
  'input_cache_write',
  'output',
  'requests',
]);

const isUnit = (key: string): key is Unit => UNITS.has(key);
// Never a declared model name, so a model reported under the wrong provider is rejected like an unknown one.
const NOT_DECLARED = '';

export function assertPaidApiDeclaration(opts: PaidApiOptions): void {
  const bad = (msg: string): never => {
    throw new MetricsConfigError('INVALID_ARGUMENT', `paid API ${JSON.stringify(opts.provider)}: ${msg}`);
  };
  if (typeof opts.provider !== 'string' || opts.provider === '') bad('provider must be a non-empty string');
  if (opts.models.length === 0 || opts.models.some((m) => typeof m !== 'string' || m === '')) {
    bad('models must be a non-empty list of non-empty strings');
  }
  for (const [model, prices] of Object.entries(opts.tariffs ?? {})) {
    if (!opts.models.includes(model)) bad(`tariff for undeclared model ${JSON.stringify(model)}`);
    for (const [unit, price] of Object.entries(prices ?? {})) {
      if (!isUnit(unit)) bad(`tariff for ${JSON.stringify(model)} has unknown unit ${JSON.stringify(unit)}`);
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) bad(`tariff ${model}/${unit} must be a finite number >= 0`);
    }
  }
}

interface Families {
  calls: BoundCounter;
  units: BoundCounter;
  cost: BoundCounter;
  unpriced: BoundCounter;
  invalid: BoundCounter;
}

/** Paid-API usage by billing provider; cost is an estimate from caller-declared tariffs. */
export class Spend {
  private readonly providers = new Map<string, { models: ReadonlySet<string>; tariffs: Map<string, Partial<Record<Unit, number>>> }>();
  private readonly providerNames = new Set<string>();
  private readonly modelNames = new Set<string>();
  private families: Families | null = null;

  constructor(private readonly metrics: Pick<Metrics, 'counter'>) {}

  declare(opts: PaidApiOptions): void {
    assertPaidApiDeclaration(opts);
    if (this.providers.has(opts.provider)) {
      throw new MetricsConfigError('DUPLICATE_DECLARATION', `paid API ${opts.provider} is already declared`);
    }
    this.families ??= this.createFamilies();
    this.providers.set(opts.provider, {
      models: new Set(opts.models),
      tariffs: new Map(Object.entries(opts.tariffs ?? {}).map(([model, prices]) => [model, { ...prices }])),
    });
    this.providerNames.add(opts.provider);
    for (const model of opts.models) this.modelNames.add(model);
  }

  record(e: PaidApiCall): void {
    const f = this.families;
    if (!f) return;
    const declared = this.providers.get(e.provider);
    const model = declared?.models.has(e.model) ? e.model : NOT_DECLARED;
    const base = { provider: e.provider, model };
    f.calls.inc({ ...base, outcome: e.outcome });
    const tariff = declared?.tariffs.get(e.model);
    let cost = 0;
    let priced = false;
    for (const [unit, amount] of Object.entries(e.units ?? {})) {
      if (!isUnit(unit) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        f.invalid.inc({ metric: 'app_paid_api_units_total' });
        continue;
      }
      f.units.inc({ ...base, unit }, amount);
      const price = tariff?.[unit];
      if (price === undefined) {
        f.unpriced.inc({ ...base, unit }, amount);
      } else {
        cost += amount * price;
        priced = true;
      }
    }
    if (priced) f.cost.inc(base, cost);
  }

  private createFamilies(): Families {
    const provider = this.providerNames as ReadonlySet<string>;
    const model = this.modelNames as ReadonlySet<string>;
    return {
      calls: this.metrics.counter({
        name: 'app_paid_api_calls_total',
        help: 'Paid API calls by billing provider, model and outcome.',
        labels: { provider, model, outcome: new Set(['success', 'failure']) },
      }),
      units: this.metrics.counter({
        name: 'app_paid_api_units_total',
        help: 'Paid API usage units (disjoint) by billing provider and model.',
        labels: { provider, model, unit: UNITS },
      }),
      cost: this.metrics.counter({
        name: 'app_paid_api_cost_usd_total',
        help: 'Estimated USD cost, only from units that have a declared tariff.',
        labels: { provider, model },
      }),
      unpriced: this.metrics.counter({
        name: 'app_paid_api_unpriced_units_total',
        help: 'Units with no declared tariff; their cost is unknown, not zero.',
        labels: { provider, model, unit: UNITS },
      }),
      invalid: this.metrics.counter({
        name: 'app_metrics_invalid_value_total',
        help: 'Negative, non-finite or unknown-unit values that were ignored, by metric.',
        labels: { metric: new Set(['app_paid_api_units_total']) },
      }),
    };
  }
}
