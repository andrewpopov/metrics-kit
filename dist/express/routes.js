"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteTable = exports.UNMATCHED = exports.MAX_ROUTES = exports.METHODS = void 0;
exports.splitRequestPath = splitRequestPath;
const errors_1 = require("../errors");
exports.METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
exports.MAX_ROUTES = 200;
exports.UNMATCHED = '__unmatched__';
const FORBIDDEN_CHARS = /[?#()[\]{}+^$|\\\s]/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RANK = { literal: 2, param: 1, rest: 0 };
const invalid = (entry, why) => new errors_1.MetricsConfigError('INVALID_ARGUMENT', `route declaration ${JSON.stringify(entry)}: ${why}`);
/** Request path without query/fragment, split into raw segments; null if not an origin-form path. */
function splitRequestPath(url) {
    const end = url.search(/[?#]/);
    const path = end === -1 ? url : url.slice(0, end);
    if (!path.startsWith('/'))
        return null;
    const segments = path.split('/').slice(1);
    if (segments.length > 1 && segments[segments.length - 1] === '')
        segments.pop();
    return segments.length === 1 && segments[0] === '' ? [] : segments;
}
function compile(entry) {
    if (typeof entry !== 'string')
        throw invalid(String(entry), 'must be a string');
    const space = entry.indexOf(' ');
    if (space === -1)
        throw invalid(entry, 'expected "<METHOD> <path>"');
    const method = entry.slice(0, space);
    const path = entry.slice(space + 1);
    if (method !== '*' && !exports.METHODS.includes(method)) {
        throw invalid(entry, `method must be one of ${exports.METHODS.join(' ')} or *`);
    }
    if (!path.startsWith('/'))
        throw invalid(entry, 'path must start with "/"');
    if (FORBIDDEN_CHARS.test(path))
        throw invalid(entry, 'path contains a query or regex character');
    const raw = splitRequestPath(path);
    if (raw === null)
        throw invalid(entry, 'path must start with "/"');
    if (path.length > 1 && path.endsWith('/'))
        throw invalid(entry, 'no trailing slash');
    const segments = raw.map((part, i) => {
        if (part === '')
            throw invalid(entry, 'empty path segment');
        if (part === '*') {
            if (i !== raw.length - 1)
                throw invalid(entry, '"*" must be the last segment');
            return { kind: 'rest' };
        }
        if (part.includes('*'))
            throw invalid(entry, '"*" must be a whole segment');
        if (part.startsWith(':')) {
            if (!PARAM_NAME.test(part.slice(1)))
                throw invalid(entry, `bad parameter segment ${JSON.stringify(part)}`);
            return { kind: 'param' };
        }
        if (part.includes(':'))
            throw invalid(entry, '":" is only allowed at the start of a segment');
        return { kind: 'literal', value: part };
    });
    return { method, path, segments };
}
/** Per-position rank of the match, or null when the request does not match. */
function score(route, request) {
    const ranks = [];
    const { segments } = route;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.kind === 'rest') {
            if (request.length <= i || request.slice(i).some((s) => s === ''))
                return null;
            ranks.push(RANK.rest);
            return ranks;
        }
        const part = request[i];
        if (part === undefined || part === '')
            return null;
        if (seg.kind === 'literal' && seg.value !== part)
            return null;
        ranks.push(RANK[seg.kind]);
    }
    return request.length === segments.length ? ranks : null;
}
/** > 0 when a is more specific than b. */
function compareScores(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i])
            return a[i] - b[i];
    }
    return a.length - b.length;
}
class RouteTable {
    constructor(entries) {
        if (entries.length > exports.MAX_ROUTES) {
            throw new errors_1.MetricsConfigError('INVALID_ARGUMENT', `at most ${exports.MAX_ROUTES} routes may be declared, got ${entries.length}`);
        }
        const seen = new Set();
        this.routes = entries.map((entry) => {
            const route = compile(entry);
            const key = `${route.method} ${route.path}`;
            if (seen.has(key))
                throw invalid(entry, 'duplicate declaration');
            seen.add(key);
            return route;
        });
        this.templates = new Set([...this.routes.map((r) => r.path), exports.UNMATCHED]);
    }
    /** The declared path template for this request, or UNMATCHED. */
    match(method, url) {
        const request = splitRequestPath(url);
        if (request === null)
            return exports.UNMATCHED;
        let best = null;
        for (const route of this.routes) {
            if (route.method !== '*' && route.method !== method)
                continue;
            const ranks = score(route, request);
            if (ranks === null)
                continue;
            if (best === null) {
                best = { route, ranks };
                continue;
            }
            const diff = compareScores(ranks, best.ranks);
            if (diff > 0 || (diff === 0 && route.method !== '*' && best.route.method === '*'))
                best = { route, ranks };
        }
        return best === null ? exports.UNMATCHED : best.route.path;
    }
}
exports.RouteTable = RouteTable;
