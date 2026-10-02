import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import { MetricsConfigError } from './errors';
import { assertLabelNames, assertLabelValue, assertMetricName, isValidLabelValue, OTHER, sanitizeLabels } from './labels';
import { Spend, SPEND_METRIC_NAMES, assertPaidApiDeclaration } from './spend';
import { Tasks, TASK_METRIC_NAMES, assertTaskDeclaration } from './tasks';
import { listenMetrics, LOOPBACK_HOST, parseStrictPort, type ListenDeps } from './server';
import type {
  BoundCounter,
  BoundGauge,
  BoundHistogram,
  MetricDef,
  Metrics,
  MetricsOptions,
  MetricsServer,
  PaidApiCall,
  PaidApiOptions,
  ServeOptions,
  TaskOptions,
} from './types';

const DEFAULT_LABEL_MAX = 64;
const REJECTED_NAME = 'app_metrics_rejected_label_total';
const BUILD_INFO_NAME = 'app_build_info';
const HISTOGRAM_SUFFIXES = ['_bucket', '_sum', '_count'] as const;
const BUILT_IN_NAMES: readonly string[] = [
  REJECTED_NAME,
  BUILD_INFO_NAME,
  ...Object.values(TASK_METRIC_NAMES),
  ...HISTOGRAM_SUFFIXES.map((suffix) => `${TASK_METRIC_NAMES.duration}${suffix}`),
  ...Object.values(SPEND_METRIC_NAMES),
];

// The client cannot stop collectDefaultMetrics (see README), so a second collector set would
// double-run the interval, event-loop histogram and GC observer for the rest of the process.
let defaultMetricsStarted = false;

function noopMetrics(validate: (def: MetricDef) => void, labelMaxLength: number): Metrics {
  const noop = (): void => undefined;
  return {
    enabled: false,
    serve: async () => null,
    render: async () => '',
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    close: async () => undefined,
    counter: (def) => (validate(def), { inc: noop }),
    gauge: (def) => (validate(def), { set: noop, inc: noop }),
    histogram: (def) => (validate(def), { observe: noop }),
    declareTask: (name, taskOpts) => assertTaskDeclaration(name, taskOpts, labelMaxLength),
    trackTask: (_name, fn) => fn(),
    declarePaidApi: assertPaidApiDeclaration,
    recordPaidApiCall: noop,
  };
}

function validateDef(def: MetricDef, forbiddenLabels: readonly string[] = []): void {
  assertMetricName(def.name);
  assertLabelNames(def, forbiddenLabels);
  for (const [label, allowed] of Object.entries(def.labels)) {
    for (const value of allowed) assertLabelValue(value, `${def.name}{${label}} value`);
  }
}

/** Every exposition name a metric of this kind emits; a histogram also owns its _bucket/_sum/_count series. */
function generatedNames(def: MetricDef, histogram: boolean): string[] {
  return histogram ? [def.name, ...HISTOGRAM_SUFFIXES.map((suffix) => `${def.name}${suffix}`)] : [def.name];
}

class EnabledMetrics implements Metrics {
  readonly enabled = true;
  private readonly registry = new Registry();
  private readonly names = new Set<string>();
  private readonly labelMax: number;
  private readonly rejected: Counter<'metric' | 'label'>;
  private readonly tasks: Tasks;
  private readonly spend: Spend;
  private server: MetricsServer | null = null;
  private starting: Promise<MetricsServer> | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;

  constructor(
    opts: MetricsOptions,
    private readonly defaultPort: string | undefined,
    private readonly deps: ListenDeps,
  ) {
    const collectDefaults = opts.defaultMetrics ?? true;
    if (collectDefaults && defaultMetricsStarted) {
      throw new MetricsConfigError(
        'DEFAULT_METRICS_ACTIVE',
        'default metrics are already collecting in this process and cannot be stopped; pass defaultMetrics: false',
      );
    }
    this.labelMax = opts.labelValueMaxLength ?? DEFAULT_LABEL_MAX;
    const internal = {
      counter: (def: MetricDef) => this.createCounter(def, true),
      gauge: (def: MetricDef) => this.createGauge(def, true),
      histogram: (def: MetricDef & { buckets: readonly number[] }) => this.createHistogram(def, true),
    };
    this.tasks = new Tasks(internal, this.labelMax);
    this.spend = new Spend(internal);
    for (const name of [REJECTED_NAME, BUILD_INFO_NAME]) this.names.add(name);
    this.rejected = new Counter({
      name: REJECTED_NAME,
      help: 'Label values rejected and recorded as __other__, by metric and label name.',
      labelNames: ['metric', 'label'],
      registers: [this.registry],
    });
    new Gauge({
      name: BUILD_INFO_NAME,
      help: 'Build information; value is always 1.',
      labelNames: ['version', 'commit'],
      registers: [this.registry],
    }).set({ version: this.buildInfoValue('version', opts.version), commit: this.buildInfoValue('commit', opts.commit ?? 'unknown') }, 1);
    if (collectDefaults) {
      defaultMetricsStarted = true;
      collectDefaultMetrics({ register: this.registry });
    }
  }

  private buildInfoValue(label: string, value: string): string {
    if (isValidLabelValue(value, this.labelMax)) return value;
    this.rejected.inc({ metric: BUILD_INFO_NAME, label });
    return OTHER;
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  async serve(opts: ServeOptions = {}): Promise<MetricsServer | null> {
    if (this.closed) throw new MetricsConfigError('ALREADY_CLOSED', 'metrics instance is closed');
    if (this.server || this.starting) {
      throw new MetricsConfigError('PORT_IN_USE', `metrics already serving${this.server ? ` on port ${this.server.port}` : ''}`);
    }
    const port = opts.port ?? (this.defaultPort === undefined ? undefined : parseStrictPort(this.defaultPort));
    if (port === undefined) throw new MetricsConfigError('INVALID_PORT', 'no metrics port: pass serve({ port }) or set METRICS_PORT');
    // Recorded synchronously, so a concurrent serve() or close() sees the startup in flight.
    const starting = this.start(port, opts.host ?? LOOPBACK_HOST);
    this.starting = starting;
    try {
      return await starting;
    } finally {
      this.starting = null;
    }
  }

  private async start(port: number, host: string): Promise<MetricsServer> {
    const server = await listenMetrics(() => this.render(), this.contentType, { port, host }, this.deps);
    if (this.closed) {
      await server.close();
      throw new MetricsConfigError('ALREADY_CLOSED', 'metrics instance was closed while starting');
    }
    this.server = server;
    return server;
  }

  close(): Promise<void> {
    return (this.closing ??= this.shutDown());
  }

  private async shutDown(): Promise<void> {
    this.closed = true;
    await this.starting?.catch(() => undefined);
    const server = this.server;
    this.server = null;
    await server?.close();
    this.registry.clear();
  }

  counter(def: MetricDef): BoundCounter {
    return this.createCounter(def, false);
  }

  gauge(def: MetricDef): BoundGauge {
    return this.createGauge(def, false);
  }

  histogram(def: MetricDef & { buckets: readonly number[] }): BoundHistogram {
    return this.createHistogram(def, false);
  }

  private createCounter(def: MetricDef, builtIn: boolean): BoundCounter {
    const metric = new Counter({ ...this.register(def, [], false, builtIn), registers: [this.registry] });
    return { inc: (labels, value) => metric.inc(this.clean(def, labels), value) };
  }

  private createGauge(def: MetricDef, builtIn: boolean): BoundGauge {
    const metric = new Gauge({ ...this.register(def, [], false, builtIn), registers: [this.registry] });
    return {
      set: (labels, value) => metric.set(this.clean(def, labels), value),
      inc: (labels, value) => metric.inc(this.clean(def, labels), value),
    };
  }

  private createHistogram(def: MetricDef & { buckets: readonly number[] }, builtIn: boolean): BoundHistogram {
    const metric = new Histogram({ ...this.register(def, ['le'], true, builtIn), buckets: [...def.buckets], registers: [this.registry] });
    return { observe: (labels, value) => metric.observe(this.clean(def, labels), value) };
  }

  declareTask(name: string, opts: TaskOptions): void {
    this.tasks.declare(name, opts);
  }

  trackTask<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.tasks.track(name, fn);
  }

  declarePaidApi(opts: PaidApiOptions): void {
    this.spend.declare(opts);
  }

  recordPaidApiCall(e: PaidApiCall): void {
    this.spend.record(e);
  }

  private register(def: MetricDef, forbiddenLabels: readonly string[], histogram: boolean, builtIn: boolean) {
    validateDef(def, forbiddenLabels);
    const generated = generatedNames(def, histogram);
    for (const name of generated) {
      if (this.names.has(name) || (!builtIn && BUILT_IN_NAMES.includes(name))) {
        throw new MetricsConfigError(
          'INVALID_NAME',
          name === def.name ? `metric ${def.name} is already registered` : `metric ${def.name} would emit ${name}, which is already registered`,
        );
      }
    }
    for (const name of generated) this.names.add(name);
    return { name: def.name, help: def.help, labelNames: Object.keys(def.labels) };
  }

  private clean(def: MetricDef, labels: Record<string, string>): Record<string, string> {
    return sanitizeLabels(def, labels, this.labelMax, (label) =>
      this.rejected.inc({ metric: def.name, label }),
    );
  }
}

export function createMetricsInternal(opts: MetricsOptions, rawPort: string | undefined, deps: ListenDeps): Metrics {
  return opts.enabled ? new EnabledMetrics(opts, rawPort, deps) : noopMetrics(validateDef, opts.labelValueMaxLength ?? DEFAULT_LABEL_MAX);
}

export function createMetrics(opts: MetricsOptions): Metrics {
  return createMetricsInternal(opts, undefined, {});
}

export function createMetricsFromEnv(
  opts: Omit<MetricsOptions, 'enabled'>,
  env: NodeJS.ProcessEnv = process.env,
): Metrics {
  const raw = env.METRICS_PORT;
  if (raw === undefined || raw === '') return createMetrics({ ...opts, enabled: false });
  // A bad METRICS_PORT is refused at serve(), before any listener exists.
  return createMetricsInternal({ ...opts, enabled: true }, raw, {});
}
