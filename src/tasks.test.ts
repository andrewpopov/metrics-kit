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
const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const sample = (text: string, line: string): boolean => text.split('\n').includes(line);
const valueOf = (text: string, prefix: string): number | undefined => {
  const row = text.split('\n').find((l) => l.startsWith(`${prefix} `));
  return row === undefined ? undefined : Number(row.slice(prefix.length + 1));
};

describe('tasks', () => {
  it('counts a success, observes duration, and sets last_success', async () => {
    const m = make();
    m.declareTask('sync', { expectedEverySeconds: 60 });
    await expect(m.trackTask('sync', async () => 42)).resolves.toBe(42);
    const text = await m.render();
    expect(text).toContain('app_task_runs_total{task="sync",outcome="success"} 1');
    expect(text).toContain('app_task_duration_seconds_count{task="sync"} 1');
    expect(text).toContain('app_task_expected_interval_seconds{task="sync"} 60');
    expect(valueOf(text, 'app_task_last_success_timestamp_seconds{task="sync"}')).toBeGreaterThan(1.7e9);
    expect(valueOf(text, 'app_task_declared_timestamp_seconds{task="sync"}')).toBeGreaterThan(1.7e9);
    expect(text).toContain('app_task_duration_seconds_bucket{le="3600",task="sync"} 1');
  });

  it('a task that throws rethrows unchanged, decrements running, counts failure and does NOT set last_success', async () => {
    const m = make();
    m.declareTask('sync', { expectedEverySeconds: 60 });
    const boom = new Error('boom');
    await expect(m.trackTask('sync', async () => Promise.reject(boom))).rejects.toBe(boom);
    const text = await m.render();
    expect(text).toContain('app_task_runs_total{task="sync",outcome="failure"} 1');
    expect(text).toContain('app_task_running{task="sync"} 0');
    expect(text).not.toContain('app_task_last_success_timestamp_seconds{');
  });

  it('a synchronously throwing fn also decrements running exactly once', async () => {
    const m = make();
    m.declareTask('sync', { expectedEverySeconds: 60 });
    const boom = new Error('sync boom');
    await expect(
      m.trackTask('sync', () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    const text = await m.render();
    expect(text).toContain('app_task_running{task="sync"} 0');
    expect(text).toContain('app_task_runs_total{task="sync",outcome="failure"} 1');
  });

  it('overlapping runs: running goes 1,2,1,0 and last_success is the max', async () => {
    const m = make();
    m.declareTask('sync', { expectedEverySeconds: 60, lastSuccessAt: 0 });
    const a = deferred();
    const b = deferred();
    const running = async () => valueOf(await m.render(), 'app_task_running{task="sync"}');
    const pa = m.trackTask('sync', () => a.promise);
    expect(await running()).toBe(1);
    const pb = m.trackTask('sync', () => b.promise);
    expect(await running()).toBe(2);
    b.resolve();
    await pb;
    expect(await running()).toBe(1);
    const afterB = valueOf(await m.render(), 'app_task_last_success_timestamp_seconds{task="sync"}');
    await new Promise((r) => setTimeout(r, 15));
    a.resolve();
    await pa;
    expect(await running()).toBe(0);
    const afterA = valueOf(await m.render(), 'app_task_last_success_timestamp_seconds{task="sync"}');
    expect(afterA).toBeGreaterThanOrEqual(afterB ?? Infinity);
  });

  it('a later-finishing older invocation never moves last_success backwards', async () => {
    const m = make();
    const future = Date.now() + 3_600_000;
    m.declareTask('sync', { expectedEverySeconds: 60, lastSuccessAt: future });
    await m.trackTask('sync', async () => undefined);
    expect(valueOf(await m.render(), 'app_task_last_success_timestamp_seconds{task="sync"}')).toBe(future / 1000);
  });

  it('a never-succeeded task exports declared and expected but no last_success', async () => {
    const m = make();
    m.declareTask('sync', { expectedEverySeconds: 5 });
    const text = await m.render();
    expect(text).toContain('app_task_declared_timestamp_seconds{task="sync"}');
    expect(text).toContain('app_task_expected_interval_seconds{task="sync"} 5');
    expect(text).not.toContain('app_task_last_success_timestamp_seconds{');
  });

  it('exports a seeded lastSuccessAt (Date and epoch ms)', async () => {
    const m = make();
    m.declareTask('a', { expectedEverySeconds: 1, lastSuccessAt: new Date(1_700_000_000_000) });
    m.declareTask('b', { expectedEverySeconds: 1, lastSuccessAt: 1_800_000_000_000 });
    const text = await m.render();
    expect(sample(text, 'app_task_last_success_timestamp_seconds{task="a"} 1700000000')).toBe(true);
    expect(sample(text, 'app_task_last_success_timestamp_seconds{task="b"} 1800000000')).toBe(true);
  });

  it('tasks can be declared after the families exist and after other tasks ran', async () => {
    const m = make();
    m.declareTask('a', { expectedEverySeconds: 1 });
    await m.trackTask('a', async () => undefined);
    m.declareTask('b', { expectedEverySeconds: 1 });
    await m.trackTask('b', async () => undefined);
    const text = await m.render();
    expect(text).toContain('app_task_runs_total{task="b",outcome="success"} 1');
    expect(text).not.toContain('="__other__"');
  });

  it('an undeclared task throws UNDECLARED_TASK and does not run fn', async () => {
    const m = make();
    let ran = false;
    const fn = async () => void (ran = true);
    await expect(m.trackTask('nope', fn)).rejects.toMatchObject({ code: 'UNDECLARED_TASK' });
    m.declareTask('a', { expectedEverySeconds: 1 });
    await expect(m.trackTask('nope', fn)).rejects.toMatchObject({ code: 'UNDECLARED_TASK' });
    expect(ran).toBe(false);
  });

  it('rejects duplicate declarations and bad arguments', () => {
    const m = make();
    m.declareTask('a', { expectedEverySeconds: 1 });
    expect(codeOf(() => m.declareTask('a', { expectedEverySeconds: 1 }))).toBe('DUPLICATE_DECLARATION');
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => m.declareTask('b', { expectedEverySeconds: bad }))).toBe('INVALID_ARGUMENT');
    }
    expect(codeOf(() => m.declareTask('', { expectedEverySeconds: 1 }))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => m.declareTask('c', { expectedEverySeconds: 1, lastSuccessAt: Number.NaN }))).toBe('INVALID_ARGUMENT');
  });

  it('disabled: validates declarations, trackTask just runs fn', async () => {
    const m = createMetrics({ enabled: false, version: '1' });
    expect(codeOf(() => m.declareTask('a', { expectedEverySeconds: 0 }))).toBe('INVALID_ARGUMENT');
    await expect(m.trackTask('never-declared', async () => 7)).resolves.toBe(7);
    expect(await m.render()).toBe('');
  });
});
