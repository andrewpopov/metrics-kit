import { MetricsConfigError } from '../errors';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const MAX_ROUTES = 200;
export const UNMATCHED = '__unmatched__';

type Segment = { kind: 'literal'; value: string } | { kind: 'param' } | { kind: 'rest' };

interface CompiledRoute {
  /** `*` = any method. */
  method: string;
  path: string;
  segments: readonly Segment[];
}

const FORBIDDEN_CHARS = /[?#()[\]{}+^$|\\\s]/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RANK = { literal: 2, param: 1, rest: 0 } as const;

const invalid = (entry: string, why: string): MetricsConfigError =>
  new MetricsConfigError('INVALID_ARGUMENT', `route declaration ${JSON.stringify(entry)}: ${why}`);

/** Request path without query/fragment, split into raw segments; null if not an origin-form path. */
export function splitRequestPath(url: string): string[] | null {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  if (!path.startsWith('/')) return null;
  const segments = path.split('/').slice(1);
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  return segments.length === 1 && segments[0] === '' ? [] : segments;
}

function compile(entry: string): CompiledRoute {
  if (typeof entry !== 'string') throw invalid(String(entry), 'must be a string');
  const space = entry.indexOf(' ');
  if (space === -1) throw invalid(entry, 'expected "<METHOD> <path>"');
  const method = entry.slice(0, space);
  const path = entry.slice(space + 1);
  if (method !== '*' && !(METHODS as readonly string[]).includes(method)) {
    throw invalid(entry, `method must be one of ${METHODS.join(' ')} or *`);
  }
  if (!path.startsWith('/')) throw invalid(entry, 'path must start with "/"');
  if (FORBIDDEN_CHARS.test(path)) throw invalid(entry, 'path contains a query or regex character');
  const raw = splitRequestPath(path);
  if (raw === null) throw invalid(entry, 'path must start with "/"');
  if (path.length > 1 && path.endsWith('/')) throw invalid(entry, 'no trailing slash');
  const segments = raw.map((part, i): Segment => {
    if (part === '') throw invalid(entry, 'empty path segment');
    if (part === '*') {
      if (i !== raw.length - 1) throw invalid(entry, '"*" must be the last segment');
      return { kind: 'rest' };
    }
    if (part.includes('*')) throw invalid(entry, '"*" must be a whole segment');
    if (part.startsWith(':')) {
      if (!PARAM_NAME.test(part.slice(1))) throw invalid(entry, `bad parameter segment ${JSON.stringify(part)}`);
      return { kind: 'param' };
    }
    if (part.includes(':')) throw invalid(entry, '":" is only allowed at the start of a segment');
    return { kind: 'literal', value: part };
  });
  return { method, path, segments };
}

/** Per-position rank of the match, or null when the request does not match. */
function score(route: CompiledRoute, request: readonly string[]): number[] | null {
  const ranks: number[] = [];
  const { segments } = route;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.kind === 'rest') {
      if (request.length <= i || request.slice(i).some((s) => s === '')) return null;
      ranks.push(RANK.rest);
      return ranks;
    }
    const part = request[i];
    if (part === undefined || part === '') return null;
    if (seg.kind === 'literal' && seg.value !== part) return null;
    ranks.push(RANK[seg.kind]);
  }
  return request.length === segments.length ? ranks : null;
}

/** > 0 when a is more specific than b. */
function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

export class RouteTable {
  private readonly routes: readonly CompiledRoute[];
  /** Every path template the table can return, plus the unmatched sentinel. */
  readonly templates: ReadonlySet<string>;

  constructor(entries: readonly string[]) {
    if (entries.length > MAX_ROUTES) {
      throw new MetricsConfigError('INVALID_ARGUMENT', `at most ${MAX_ROUTES} routes may be declared, got ${entries.length}`);
    }
    const seen = new Set<string>();
    this.routes = entries.map((entry) => {
      const route = compile(entry);
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) throw invalid(entry, 'duplicate declaration');
      seen.add(key);
      return route;
    });
    this.templates = new Set([...this.routes.map((r) => r.path), UNMATCHED]);
  }

  /** The declared path template for this request, or UNMATCHED. */
  match(method: string, url: string): string {
    const request = splitRequestPath(url);
    if (request === null) return UNMATCHED;
    let best: { route: CompiledRoute; ranks: number[] } | null = null;
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const ranks = score(route, request);
      if (ranks === null) continue;
      if (best === null) {
        best = { route, ranks };
        continue;
      }
      const diff = compareScores(ranks, best.ranks);
      if (diff > 0 || (diff === 0 && route.method !== '*' && best.route.method === '*')) best = { route, ranks };
    }
    return best === null ? UNMATCHED : best.route.path;
  }
}
