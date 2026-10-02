import { register as globalRegister } from '@prometheus-io/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetrics, createMetricsFromEnv, MetricsConfigError, type Metrics } from './index';
import { createMetricsInternal } from './metrics';

const open: Metrics[] = [];
const make = (opts: Partial<Parameters<typeof createMetrics>[0]> = {}): Metrics => {
  const m = createMetrics({ enabled: true, version: '1.2.3', defaultMetrics: false, ...opts });
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

const def = (labels: Record<string, ReadonlySet<string> | 'closed'> = { route: new Set(['/a']) }) => ({
  name: 'app_things_total',
  help: 'things',
  labels,
});

describe('registry isolation', () => {
  it('never touches the library global registry', async () => {
    const before = await globalRegister.metrics();
    const a = make({ defaultMetrics: true });
    const b = make({ defaultMetrics: true });
    a.counter(def()).inc({ route: '/a' });
    b.counter(def()).inc({ route: '/a' });
    await a.render();
    const after = await globalRegister.metrics();
    expect(after).toBe(before);
    expect(after).not.toContain('app_things_total');
    expect(after).not.toContain('app_build_info');
  });

  it('keeps two instances independent', async () => {
    const a = make();
    const b = make();
    a.counter(def()).inc({ route: '/a' }, 3);
    b.counter(def()).inc({ route: '/a' }, 5);
    expect(await a.render()).toContain('app_things_total{route="/a"} 3');
    expect(await b.render()).toContain('app_things_total{route="/a"} 5');
  });
});

describe('label names', () => {
  it.each(['job', 'instance', 'app', 'host', '__name__', '__x'])('rejects reserved label %s', (label) => {
    expect(codeOf(() => make().counter(def({ [label]: 'closed' })))).toBe('RESERVED_LABEL');
  });

  it('rejects reserved label names on gauges and histograms too', () => {
    expect(codeOf(() => make().gauge(def({ host: 'closed' })))).toBe('RESERVED_LABEL');
    expect(codeOf(() => make().histogram({ ...def({ job: 'closed' }), buckets: [1] }))).toBe('RESERVED_LABEL');
  });

  it('rejects reserved label names even when disabled', () => {
    expect(codeOf(() => createMetrics({ enabled: false, version: '1' }).counter(def({ app: 'closed' })))).toBe('RESERVED_LABEL');
  });
});

describe('metric names', () => {
  it.each(['Bad', '1abc', 'a-b', 'a b', ''])('rejects %j', (name) => {
    expect(codeOf(() => make().counter({ ...def(), name }))).toBe('INVALID_NAME');
  });

  it('rejects a duplicate name and the built-in names', () => {
    const m = make();
    m.counter(def());
    expect(codeOf(() => m.gauge(def()))).toBe('INVALID_NAME');
    expect(codeOf(() => m.counter({ ...def(), name: 'app_build_info' }))).toBe('INVALID_NAME');
  });

  it('rejects "le" as a histogram label', () => {
    expect(codeOf(() => make().histogram({ ...def({ le: 'closed' }), buckets: [1] }))).toBe('INVALID_NAME');
  });
});

describe('label values', () => {
  it('records unknown values as __other__ and counts the rejection by metric and label name', async () => {
    const m = make();
    m.counter(def()).inc({ route: 'secret-token-abc123' });
    const text = await m.render();
    expect(text).toContain('app_things_total{route="__other__"} 1');
    expect(text).toContain('app_metrics_rejected_label_total{metric="app_things_total",label="route"} 1');
  });

  it('never renders a rejected value anywhere', async () => {
    const m = make();
    m.counter(def()).inc({ route: 'secret-token-abc123' });
    m.gauge({ name: 'g', help: 'g', labels: { kind: new Set(['x']) } }).set({ kind: 'secret-token-abc123' }, 1);
    m.histogram({ name: 'h', help: 'h', labels: { kind: new Set(['x']) }, buckets: [1] }).observe({ kind: 'secret-token-abc123' }, 1);
    expect(await m.render()).not.toContain('secret-token-abc123');
  });

  it('rejects values longer than labelValueMaxLength, even for closed labels', async () => {
    const m = make({ labelValueMaxLength: 8 });
    m.counter({ name: 'c', help: 'c', labels: { k: 'closed' } }).inc({ k: 'x'.repeat(9) });
    const text = await m.render();
    expect(text).toContain('c{k="__other__"} 1');
    expect(text).not.toContain('xxxxxxxxx');
  });

  it('passes allowed values and closed-label values through', async () => {
    const m = make();
    m.counter({ name: 'c', help: 'c', labels: { k: 'closed', r: new Set(['/a']) } }).inc({ k: 'anything', r: '/a' });
    const text = await m.render();
    expect(text).toContain('c{k="anything",r="/a"} 1');
    expect(text).not.toContain('app_metrics_rejected_label_total{');
  });

  it('treats a missing declared label as rejected and ignores undeclared keys', async () => {
    const m = make();
    m.counter(def()).inc({ extra: 'leaky-value' });
    const text = await m.render();
    expect(text).toContain('app_things_total{route="__other__"} 1');
    expect(text).not.toContain('leaky-value');
  });

  it('observes histograms and sets gauges', async () => {
    const m = make();
    m.histogram({ name: 'h', help: 'h', labels: { k: new Set(['x']) }, buckets: [1, 2] }).observe({ k: 'x' }, 1.5);
    m.gauge({ name: 'g', help: 'g', labels: {} }).set({}, 7);
    const text = await m.render();
    expect(text).toContain('h_bucket{le="2",k="x"} 1');
    expect(text).toContain('g 7');
  });
});

describe('build info and default metrics', () => {
  it('registers app_build_info{version,commit} = 1 with commit defaulting to unknown', async () => {
    expect(await make().render()).toContain('app_build_info{version="1.2.3",commit="unknown"} 1');
    expect(await make({ commit: 'abc123' }).render()).toContain('commit="abc123"');
  });

  it('length-caps version and commit', async () => {
    const text = await make({ version: 'v'.repeat(100), labelValueMaxLength: 10 }).render();
    expect(text).toContain(`version="${'v'.repeat(10)}"`);
    expect(text).not.toContain('v'.repeat(11));
  });

  it('collects default metrics into its own registry by default, and not when turned off', async () => {
    expect(await make({ defaultMetrics: true }).render()).toContain('process_cpu_user_seconds_total');
    expect(await make().render()).not.toContain('process_cpu_user_seconds_total');
  });
});

describe('disabled', () => {
  it('is inert: no output, no server, and creates no timers or handles', async () => {
    const before = process.getActiveResourcesInfo();
    const timers = vi.spyOn(globalThis, 'setInterval');
    const m = createMetrics({ enabled: false, version: '1', defaultMetrics: true });
    m.counter(def()).inc({ route: '/a' });
    m.gauge(def()).set({ route: '/a' }, 1);
    m.histogram({ ...def(), buckets: [1] }).observe({ route: '/a' }, 1);
    expect(m.enabled).toBe(false);
    expect(await m.render()).toBe('');
    expect(await m.serve({ port: 9500 })).toBeNull();
    await m.close();
    await m.close();
    expect(process.getActiveResourcesInfo()).toEqual(before);
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
  });

  it('the enabled default-metrics collector does start a timer (so the check above can fail)', () => {
    const timers = vi.spyOn(globalThis, 'setInterval');
    make({ defaultMetrics: true });
    expect(timers).toHaveBeenCalled();
    timers.mockRestore();
  });
});

describe('createMetricsFromEnv', () => {
  it.each([undefined, ''])('is disabled when METRICS_PORT is %j', (value) => {
    expect(createMetricsFromEnv({ version: '1' }, { METRICS_PORT: value }).enabled).toBe(false);
  });

  it('is enabled when METRICS_PORT is set', async () => {
    const m = createMetricsFromEnv({ version: '1', defaultMetrics: false }, { METRICS_PORT: '9500' });
    open.push(m);
    expect(m.enabled).toBe(true);
  });

  it('serve() with no port and no env port is INVALID_PORT', async () => {
    await expect(make().serve()).rejects.toMatchObject({ code: 'INVALID_PORT' });
  });
});

describe('internal hook is not public', () => {
  it('createMetricsInternal is not exported from the package entry', async () => {
    const pkg = await import('./index');
    expect(Object.keys(pkg)).not.toContain('createMetricsInternal');
    expect(typeof createMetricsInternal).toBe('function');
  });
});
