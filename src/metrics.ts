import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import { MetricsConfigError } from './errors';
import { assertLabelNames, assertMetricName, sanitizeLabels } from './labels';
import { listenMetrics, LOOPBACK_HOST, parseStrictPort, type ListenDeps } from './server';
import type {
  BoundCounter,
  BoundGauge,
  BoundHistogram,
  MetricDef,
  Metrics,
  MetricsOptions,
  MetricsServer,
  ServeOptions,
} from './types';

const DEFAULT_LABEL_MAX = 64;
const REJECTED_NAME = 'app_metrics_rejected_label_total';
const BUILD_INFO_NAME = 'app_build_info';

function noopMetrics(validate: (def: MetricDef) => void): Metrics {
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
  };
}

function validateDef(def: MetricDef, forbiddenLabels: readonly string[] = []): void {
  assertMetricName(def.name);
  assertLabelNames(def, forbiddenLabels);
}

class EnabledMetrics implements Metrics {
  readonly enabled = true;
  private readonly registry = new Registry();
  private readonly names = new Set<string>();
  private readonly labelMax: number;
  private readonly rejected: Counter<'metric' | 'label'>;
  private server: MetricsServer | null = null;
  private closed = false;

  constructor(
    opts: MetricsOptions,
    private readonly defaultPort: string | undefined,
    private readonly deps: ListenDeps,
  ) {
    this.labelMax = opts.labelValueMaxLength ?? DEFAULT_LABEL_MAX;
    this.names.add(REJECTED_NAME).add(BUILD_INFO_NAME);
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
    }).set(
      { version: opts.version.slice(0, this.labelMax), commit: (opts.commit ?? 'unknown').slice(0, this.labelMax) },
      1,
    );
    if (opts.defaultMetrics ?? true) collectDefaultMetrics({ register: this.registry });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  async serve(opts: ServeOptions = {}): Promise<MetricsServer | null> {
    if (this.closed) throw new MetricsConfigError('ALREADY_CLOSED', 'metrics instance is closed');
    if (this.server) {
      throw new MetricsConfigError('PORT_IN_USE', `metrics already serving on port ${this.server.port}`);
    }
    const port = opts.port ?? (this.defaultPort === undefined ? undefined : parseStrictPort(this.defaultPort));
    if (port === undefined) throw new MetricsConfigError('INVALID_PORT', 'no metrics port: pass serve({ port }) or set METRICS_PORT');
    const server = await listenMetrics(() => this.render(), this.contentType, { port, host: opts.host ?? LOOPBACK_HOST }, this.deps);
    this.server = server;
    return server;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const server = this.server;
    this.server = null;
    await server?.close();
  }

  counter(def: MetricDef): BoundCounter {
    const metric = new Counter({ ...this.register(def), registers: [this.registry] });
    return { inc: (labels, value) => metric.inc(this.clean(def, labels), value) };
  }

  gauge(def: MetricDef): BoundGauge {
    const metric = new Gauge({ ...this.register(def), registers: [this.registry] });
    return {
      set: (labels, value) => metric.set(this.clean(def, labels), value),
      inc: (labels, value) => metric.inc(this.clean(def, labels), value),
    };
  }

  histogram(def: MetricDef & { buckets: readonly number[] }): BoundHistogram {
    const metric = new Histogram({ ...this.register(def, ['le']), buckets: [...def.buckets], registers: [this.registry] });
    return { observe: (labels, value) => metric.observe(this.clean(def, labels), value) };
  }

  private register(def: MetricDef, forbiddenLabels: readonly string[] = []) {
    validateDef(def, forbiddenLabels);
    if (this.names.has(def.name)) {
      throw new MetricsConfigError('INVALID_NAME', `metric ${def.name} is already registered`);
    }
    this.names.add(def.name);
    return { name: def.name, help: def.help, labelNames: Object.keys(def.labels) };
  }

  private clean(def: MetricDef, labels: Record<string, string>): Record<string, string> {
    return sanitizeLabels(def, labels, this.labelMax, (label) =>
      this.rejected.inc({ metric: def.name, label }),
    );
  }
}

export function createMetricsInternal(opts: MetricsOptions, rawPort: string | undefined, deps: ListenDeps): Metrics {
  return opts.enabled ? new EnabledMetrics(opts, rawPort, deps) : noopMetrics(validateDef);
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
