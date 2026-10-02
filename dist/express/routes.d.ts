export declare const METHODS: readonly ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export declare const MAX_ROUTES = 200;
export declare const UNMATCHED = "__unmatched__";
/** Request path without query/fragment, split into raw segments; null if not an origin-form path. */
export declare function splitRequestPath(url: string): string[] | null;
export declare class RouteTable {
    private readonly routes;
    /** Every path template the table can return, plus the unmatched sentinel. */
    readonly templates: ReadonlySet<string>;
    constructor(entries: readonly string[]);
    /** The declared path template for this request, or UNMATCHED. */
    match(method: string, url: string): string;
}
