#!/usr/bin/env node
/**
 * Pack the package, install the tarball into a throwaway consumer and assert:
 *   1. the declared entry points' .js/.d.ts ship in the tarball;
 *   2. CommonJS require() and native ESM import both resolve the root and
 *      ./express entries;
 *   3. the root entry loads with the optional `express` peer ABSENT.
 * Exits non-zero with a clear message on any failure.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
function fail(message) {
  console.error(`\n[verify:pack] FAIL: ${message}\n`);
  process.exit(1);
}

const REQUIRED_FILES = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/express/index.js',
  'dist/express/index.d.ts',
];

const workDir = mkdtempSync(join(tmpdir(), 'metrics-kit-verify-'));
try {
  console.log('[verify:pack] Building...');
  run('npm', ['run', 'build'], { cwd: pkgRoot, stdio: 'inherit' });

  console.log('[verify:pack] Packing tarball...');
  const [{ filename }] = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', workDir], { cwd: pkgRoot }),
  );
  const tarballPath = join(workDir, filename);

  const contents = run('tar', ['-tzf', tarballPath]);
  for (const file of REQUIRED_FILES) {
    if (!contents.includes(`package/${file}`)) fail(`${file} is not present in the packed tarball`);
  }
  console.log(`[verify:pack] OK: ${REQUIRED_FILES.join(', ')} ship in tarball`);

  const consumerDir = join(workDir, 'consumer');
  mkdirSync(consumerDir);
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'metrics-kit-consumer', version: '1.0.0', private: true }, null, 2),
  );
  // Deliberately no `express`: the optional peer must not be needed to load the root entry.
  console.log('[verify:pack] Installing tarball into consumer (no express peer)...');
  run('npm', ['install', '--no-audit', '--no-fund', tarballPath], { cwd: consumerDir, stdio: 'inherit' });

  const cjs = `
    const root = require('${pkg.name}');
    if (root.METRICS_KIT_PLACEHOLDER !== true) throw new Error('cjs root export missing');
    const adapter = require('${pkg.name}/express');
    if (adapter.METRICS_KIT_EXPRESS_PLACEHOLDER !== true) throw new Error('cjs ./express export missing');
  `;
  run('node', ['-e', cjs], { cwd: consumerDir });
  console.log('[verify:pack] OK: CommonJS require() resolves root and ./express');

  const esm = `
    import { METRICS_KIT_PLACEHOLDER } from '${pkg.name}';
    import { METRICS_KIT_EXPRESS_PLACEHOLDER } from '${pkg.name}/express';
    if (METRICS_KIT_PLACEHOLDER !== true) throw new Error('esm root export missing');
    if (METRICS_KIT_EXPRESS_PLACEHOLDER !== true) throw new Error('esm ./express export missing');
  `;
  run('node', ['--input-type=module', '-e', esm], { cwd: consumerDir });
  console.log('[verify:pack] OK: native ESM import resolves root and ./express');

  console.log('[verify:pack] PASS');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
