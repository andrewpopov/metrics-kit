import type { Metrics, TaskOptions } from './types';
export declare const TASK_DURATION_BUCKETS: readonly [1, 5, 15, 60, 300, 900, 3600];
export declare function assertTaskDeclaration(name: string, opts: TaskOptions): void;
/**
 * Scheduled-work heartbeats. Metric families are created on the first declaration and
 * share one mutable `task` value set, so tasks can be declared at any time before use.
 */
export declare class Tasks {
    private readonly metrics;
    private readonly names;
    private readonly lastSuccessMs;
    private families;
    constructor(metrics: Pick<Metrics, 'counter' | 'gauge' | 'histogram'>);
    declare(name: string, opts: TaskOptions): void;
    track<T>(name: string, fn: () => Promise<T>): Promise<T>;
    private recordSuccess;
    private createFamilies;
}
