import type { Metrics, PaidApiCall, PaidApiOptions } from './types';
export declare const UNITS: ReadonlySet<string>;
export declare const SPEND_METRIC_NAMES: {
    readonly calls: "app_paid_api_calls_total";
    readonly units: "app_paid_api_units_total";
    readonly cost: "app_paid_api_cost_usd_total";
    readonly unpriced: "app_paid_api_unpriced_units_total";
    readonly invalid: "app_metrics_invalid_value_total";
};
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
