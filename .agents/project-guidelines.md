# metrics-kit project guidelines

`@andrewpopov/metrics-kit`: fleet application metrics for Node services on
`@prometheus-io/client` (successor of the deprecated `prom-client`) — declared-route HTTP RED, runtime, task heartbeats, paid-API
usage — exposed on a loopback-only listener. Status: v0.1 in progress
(PKG-202; design: PKG-201 rev 2). Fleet-wide package rules live in
`packages-meta`; this package's source and packed exports are authoritative.

## Layout

- `src/` outside `src/express/` — framework-free core (entry `.`). Must never
  import `express`; `scripts/check-core-agnostic.mjs` (wired into `typecheck`)
  enforces it.
- `src/express/` — Express adapter (entry `./express`), the only place the
  optional `express` peer (`>=4`) is imported. Tests run against both v5
  (`express`) and v4 (the `express4` npm alias).
- CommonJS output, like `express-security-kit`, so CJS and ESM consumers both work.
- `dist/` is tracked: consumers install from a git tag.

## Design decisions

- **One explicit Registry per `createMetrics()`.** Never the client library's global
  registry, so two instances in one process (and tests) cannot collide.
- **`/metrics` on a separate loopback-only listener.** Bound to the literal
  `127.0.0.1` on `METRICS_PORT`; inert when unset. Never mounted on the app's
  public router.
- **Route labels come from declared templates.** The kit matches the request
  against templates the app declares; it never reads `req.baseUrl`/`req.route`
  (unbounded cardinality, mount-order dependent).
- **Closed label values.** Every label value comes from a declared set or a
  closed enum; anything unknown becomes `__other__`. Label names `job`,
  `instance`, `app`, `host` are reserved (Prometheus target labels) and rejected.
- **Tasks, not "jobs"**, with heartbeat metrics (last start/success/failure,
  duration), so staleness is alertable.
- **Paid-API units by billing provider**, so cost metrics follow the invoice,
  not the calling library.

## Rules

- Every export is a compatibility commitment; add a `.changes/unreleased/`
  fragment for any user-visible change (see `RELEASING.md`).
- Do not hand-edit `CHANGELOG.md`; release-kit compiles it.

## Verify

`npm install && npm run verify` (typecheck + layering guard, tests, build,
dist freshness, pack smoke, audits). `verify:dist-fresh` needs `src/` and
`dist/` committed first. The committed `.githooks/pre-push` runs the same chain.
