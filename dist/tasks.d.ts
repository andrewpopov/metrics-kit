import type { Metrics, TaskOptions } from './types';
export declare const TASK_DURATION_BUCKETS: readonly [1, 5, 15, 60, 300, 900, 3600];
export declare const TASK_METRIC_NAMES: {
    readonly runs: "app_task_runs_total";
    readonly duration: "app_task_duration_seconds";
    readonly running: "app_task_running";
    readonly lastSuccess: "app_task_last_success_timestamp_seconds";
    readonly declared: "app_task_declared_timestamp_seconds";
    readonly expected: "app_task_expected_interval_seconds";
};
/** Task state is keyed by name, so a name must export verbatim: one that would be coerced to `__other__` could share a series. */
export declare function assertTaskDeclaration(name: string, opts: TaskOptions, labelMaxLength: number): void;
/**
 * Scheduled-work heartbeats. Metric families are created on the first declaration and
 * share one mutable `task` value set, so tasks can be declared at any time before use.
 */
export declare class Tasks {
    private readonly metrics;
    private readonly labelMaxLength;
    private readonly names;
    private readonly lastSuccessMs;
    private families;
    constructor(metrics: Pick<Metrics, 'counter' | 'gauge' | 'histogram'>, labelMaxLength: number);
    declare(name: string, opts: TaskOptions): void;
    track<T>(name: string, fn: () => Promise<T>): Promise<T>;
    private recordSuccess;
    private createFamilies;
}
