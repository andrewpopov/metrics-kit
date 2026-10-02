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
    /**
     * Per label: the allowed value set (anything else is recorded as `__other__`).
     * `'closed'` is for adapter-internal enums validated by the caller; those values
     * are still length-capped.
     */
    labels: Record<string, ReadonlySet<string> | 'closed'>;
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
    counter(def: MetricDef & {
        buckets?: never;
    }): BoundCounter;
    gauge(def: MetricDef & {
        buckets?: never;
    }): BoundGauge;
    histogram(def: MetricDef & {
        buckets: readonly number[];
    }): BoundHistogram;
}
