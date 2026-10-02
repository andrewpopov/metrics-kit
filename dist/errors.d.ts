export type MetricsConfigErrorCode = 'NON_LOOPBACK_HOST' | 'RESERVED_LABEL' | 'CLUSTER_WORKER' | 'INVALID_PORT' | 'PORT_IN_USE' | 'INVALID_NAME' | 'ALREADY_CLOSED' | 'UNDECLARED_TASK' | 'DUPLICATE_DECLARATION' | 'INVALID_ARGUMENT';
export declare class MetricsConfigError extends Error {
    readonly code: MetricsConfigErrorCode;
    constructor(code: MetricsConfigErrorCode, message: string);
}
