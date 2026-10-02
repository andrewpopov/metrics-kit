import type { MetricsServer } from './types';
export declare const LOOPBACK_HOST = "127.0.0.1";
export interface ListenDeps {
    isWorker?: boolean;
    /** Test-only: permits port 0 (OS-assigned). Never reachable from the public API. */
    allowEphemeralPort?: boolean;
}
export declare function parseStrictPort(raw: string): number;
/** Validates everything before any listener exists, then listens. */
export declare function listenMetrics(render: () => Promise<string>, contentType: string, target: {
    port: number;
    host: string;
}, deps: ListenDeps): Promise<MetricsServer>;
