import type { Metrics, PaidApiCall, PaidApiOptions } from './types';
export declare const UNITS: ReadonlySet<string>;
export declare function assertPaidApiDeclaration(opts: PaidApiOptions): void;
/** Paid-API usage by billing provider; cost is an estimate from caller-declared tariffs. */
export declare class Spend {
    private readonly metrics;
    private readonly providers;
    private readonly providerNames;
    private readonly modelNames;
    private families;
    constructor(metrics: Pick<Metrics, 'counter'>);
    declare(opts: PaidApiOptions): void;
    record(e: PaidApiCall): void;
    private createFamilies;
}
