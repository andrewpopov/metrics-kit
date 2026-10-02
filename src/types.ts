export interface MetricsOptions {
  enabled: boolean;
  /** App version, exposed as app_build_info{version}. */
  version: string;
  /** Commit id, exposed as app_build_info{commit}. Default 'unknown'. */
  commit?: string;
  /** Collect the library's default runtime metrics. Default true. */
  defaultMetrics?: boolean;
  /** Label values longer than this are rejected like unknown ones. Default 64. */
  labelValueMaxLength?: number;
}

export interface MetricDef {
  /** Must match ^[a-z_][a-z0-9_]*$. */
  name: string;
  help: string;
  /** Per label: the allowed value set (anything else is recorded as `__other__`). Closed enums are explicit sets too. */
  labels: Record<string, ReadonlySet<string>>;
}

export interface TaskOptions {
  /** Expected seconds between successful runs; finite and > 0. */
  expectedEverySeconds: number;
  /** Seed for app_task_last_success_timestamp_seconds (Date or epoch ms), e.g. restored from a database. */
  lastSuccessAt?: Date | number;
}

export type Unit = 'input_uncached' | 'input_cache_read' | 'input_cache_write' | 'output' | 'requests';

export interface PaidApiOptions {
  /** Billing vendor, e.g. 'anthropic', 'openai', 'alibaba', 'zai', 'google-places'. */
  provider: string;
  /** Model aliases the app will report. */
  models: readonly string[];
  /** USD per unit, per model. Units without a price are reported as unpriced, never as $0. */
  tariffs?: Partial<Record<string, Partial<Record<Unit, number>>>>;
}

export interface PaidApiCall {
  provider: string;
  model: string;
  outcome: 'success' | 'failure';
  /** Disjoint units; non-negative finite numbers only. */
  units?: Partial<Record<Unit, number>>;
}

export type LabelInput = Record<string, string>;

export interface BoundCounter {
  inc(labels: LabelInput, value?: number): void;
}

export interface BoundGauge {
  set(labels: LabelInput, value: number): void;
  inc(labels: LabelInput, value?: number): void;
}

export interface BoundHistogram {
  observe(labels: LabelInput, value: number): void;
}

export interface MetricsServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface ServeOptions {
  port?: number;
  host?: string;
}

export interface Metrics {
  readonly enabled: boolean;
  /** Serve /metrics on 127.0.0.1:<port>. Port defaults to the one createMetricsFromEnv read. Null when disabled. */
  serve(opts?: ServeOptions): Promise<MetricsServer | null>;
  /** Exposition text ('' when disabled). */
  render(): Promise<string>;
  readonly contentType: string;
  /** Stops the server; idempotent. See README for what default metrics leave running. */
  close(): Promise<void>;
  counter(def: MetricDef & { buckets?: never }): BoundCounter;
  gauge(def: MetricDef & { buckets?: never }): BoundGauge;
  histogram(def: MetricDef & { buckets: readonly number[] }): BoundHistogram;
  /** Declare a scheduled task before tracking it. Throws on a duplicate or invalid declaration. */
  declareTask(name: string, opts: TaskOptions): void;
  /** Run fn as one invocation of a declared task; fn's error is rethrown unchanged. Undeclared → UNDECLARED_TASK. */
  trackTask<T>(name: string, fn: () => Promise<T>): Promise<T>;
  declarePaidApi(opts: PaidApiOptions): void;
  recordPaidApiCall(e: PaidApiCall): void;
}
