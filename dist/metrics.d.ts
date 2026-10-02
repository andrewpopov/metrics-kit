import { type ListenDeps } from './server';
import type { Metrics, MetricsOptions } from './types';
export declare function createMetricsInternal(opts: MetricsOptions, rawPort: string | undefined, deps: ListenDeps): Metrics;
export declare function createMetrics(opts: MetricsOptions): Metrics;
export declare function createMetricsFromEnv(opts: Omit<MetricsOptions, 'enabled'>, env?: NodeJS.ProcessEnv): Metrics;
