"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsConfigError = void 0;
class MetricsConfigError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'MetricsConfigError';
        this.code = code;
    }
}
exports.MetricsConfigError = MetricsConfigError;
