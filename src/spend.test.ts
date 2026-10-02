import { afterEach, describe, expect, it } from 'vitest';
import { createMetrics, MetricsConfigError, type Metrics } from './index';

const open: Metrics[] = [];
const make = (): Metrics => {
  const m = createMetrics({ enabled: true, version: '1', defaultMetrics: false });
  open.push(m);
  return m;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((m) => m.close()));
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof MetricsConfigError ? err.code : `other:${String(err)}`;
  }
  return undefined;
};

describe('paid-API usage', () => {
  it('priced units produce cost = sum(units x price) and no unpriced series', async () => {
    const m = make();
    m.declarePaidApi({ provider: 'anthropic', models: ['sonnet'], tariffs: { sonnet: { input_uncached: 0.5, output: 2 } } });
    m.recordPaidApiCall({ provider: 'anthropic', model: 'sonnet', outcome: 'success', units: { input_uncached: 4, output: 3 } });
    m.recordPaidApiCall({ provider: 'anthropic', model: 'sonnet', outcome: 'failure', units: { output: 1 } });
    const text = await m.render();
    expect(text).toContain('app_paid_api_cost_usd_total{provider="anthropic",model="sonnet"} 10');
    expect(text).toContain('app_paid_api_units_total{provider="anthropic",model="sonnet",unit="output"} 4');
    expect(text).toContain('app_paid_api_calls_total{provider="anthropic",model="sonnet",outcome="success"} 1');
    expect(text).toContain('app_paid_api_calls_total{provider="anthropic",model="sonnet",outcome="failure"} 1');
    expect(text).not.toContain('app_paid_api_unpriced_units_total{');
  });

  it('an unpriced model records unpriced units and NO cost series', async () => {
    const m = make();
    m.declarePaidApi({ provider: 'zai', models: ['glm'] });
    m.recordPaidApiCall({ provider: 'zai', model: 'glm', outcome: 'success', units: { output: 9, requests: 1 } });
    const text = await m.render();
    expect(text).toContain('app_paid_api_unpriced_units_total{provider="zai",model="glm",unit="output"} 9');
    expect(text).toContain('app_paid_api_unpriced_units_total{provider="zai",model="glm",unit="requests"} 1');
    expect(text).not.toContain('app_paid_api_cost_usd_total{');
  });

  it('mixed: priced units go to cost, unpriced to unpriced_units', async () => {
    const m = make();
    m.declarePaidApi({ provider: 'openai', models: ['gpt'], tariffs: { gpt: { output: 4 } } });
    m.recordPaidApiCall({ provider: 'openai', model: 'gpt', outcome: 'success', units: { output: 2, input_cache_read: 100 } });
    const text = await m.render();
    expect(text).toContain('app_paid_api_cost_usd_total{provider="openai",model="gpt"} 8');
    expect(text).toContain('app_paid_api_unpriced_units_total{provider="openai",model="gpt",unit="input_cache_read"} 100');
    expect(text).not.toContain('unpriced_units_total{provider="openai",model="gpt",unit="output"}');
  });

  it('invalid unit values are counted, not added', async () => {
    const m = make();
    m.declarePaidApi({ provider: 'openai', models: ['gpt'], tariffs: { gpt: { output: 1 } } });
    m.recordPaidApiCall({ provider: 'openai', model: 'gpt', outcome: 'success', units: { output: -5, requests: Number.NaN, input_uncached: Number.POSITIVE_INFINITY } });
    const text = await m.render();
    expect(text).toContain('app_metrics_invalid_value_total{metric="app_paid_api_units_total"} 3');
    expect(text).not.toContain('app_paid_api_units_total{');
    expect(text).not.toContain('app_paid_api_cost_usd_total{');
  });

  it('undeclared provider, model, or a model under the wrong provider becomes __other__', async () => {
    const m = make();
    m.declarePaidApi({ provider: 'a', models: ['m1'] });
    m.declarePaidApi({ provider: 'b', models: ['m2'] });
    m.recordPaidApiCall({ provider: 'nope', model: 'm1', outcome: 'success' });
    m.recordPaidApiCall({ provider: 'a', model: 'm2', outcome: 'success' });
    m.recordPaidApiCall({ provider: 'a', model: 'zzz', outcome: 'success' });
    const text = await m.render();
    expect(text).toContain('app_paid_api_calls_total{provider="__other__",model="__other__",outcome="success"} 1');
    expect(text).toContain('app_paid_api_calls_total{provider="a",model="__other__",outcome="success"} 2');
    expect(text).not.toContain('zzz');
  });

  it('recording before any declaration is a no-op', async () => {
    const m = make();
    m.recordPaidApiCall({ provider: 'a', model: 'm', outcome: 'success' });
    expect(await m.render()).not.toContain('app_paid_api');
  });

  it('rejects duplicates and bad declarations', () => {
    const m = make();
    m.declarePaidApi({ provider: 'a', models: ['m'] });
    expect(codeOf(() => m.declarePaidApi({ provider: 'a', models: ['m'] }))).toBe('DUPLICATE_DECLARATION');
    expect(codeOf(() => m.declarePaidApi({ provider: '', models: ['m'] }))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => m.declarePaidApi({ provider: 'b', models: [] }))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => m.declarePaidApi({ provider: 'b', models: ['m'], tariffs: { other: { output: 1 } } }))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => m.declarePaidApi({ provider: 'b', models: ['m'], tariffs: { m: { output: -1 } } }))).toBe('INVALID_ARGUMENT');
  });

  it('disabled: validates declarations, records nothing', async () => {
    const m = createMetrics({ enabled: false, version: '1' });
    expect(codeOf(() => m.declarePaidApi({ provider: 'b', models: [] }))).toBe('INVALID_ARGUMENT');
    m.declarePaidApi({ provider: 'a', models: ['m'] });
    m.recordPaidApiCall({ provider: 'a', model: 'm', outcome: 'success', units: { output: 1 } });
    expect(await m.render()).toBe('');
  });
});
