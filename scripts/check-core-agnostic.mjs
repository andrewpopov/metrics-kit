#!/usr/bin/env node
/**
 * Layering guard: everything under src/ OUTSIDE src/express/ is the
 * framework-free core and must never import `express` (value import,
 * `import type`, `require()` or dynamic `import()`), and must never
 * relative-import into src/express/. Only src/express/ may touch the
 * optional `express` peer. Test files are exempt (never shipped in dist/).
 * Computed specifiers cannot be regex-detected; the guarantee covers
 * literal string specifiers only.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(pkgRoot, 'src');
const expressRoot = join(srcRoot, 'express');
const expressRootWithSep = expressRoot + sep;

const FORBIDDEN_IMPORT =
  /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"](express)(?:\/[^'"]*)?['"]/g;
const RELATIVE_IMPORT =
  /(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]*)['"]/g;

const isTestFile = (path) => path.includes('__tests__/') || /\.test\.ts$/.test(path);
const isExpressAdapter = (file) => file === expressRoot || file.startsWith(expressRootWithSep);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

const violations = [];
for (const file of walk(srcRoot)) {
  const relPath = relative(pkgRoot, file);
  if (isTestFile(relPath) || isExpressAdapter(file)) continue;
  const contents = readFileSync(file, 'utf8');

  for (const match of contents.match(FORBIDDEN_IMPORT) ?? []) {
    violations.push(`${relPath}: ${match.trim()}`);
  }
  for (const [, specifier] of contents.matchAll(RELATIVE_IMPORT)) {
    const resolved = resolve(dirname(file), specifier);
    if (resolved === expressRoot || resolved.startsWith(expressRootWithSep)) {
      violations.push(`${relPath}: '${specifier}' reaches into src/express/`);
    }
  }
}

if (violations.length > 0) {
  console.error('\n[check-core-agnostic] FAIL: core (src/ outside src/express/) must stay express-free.\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('');
  process.exit(1);
}

console.log('[check-core-agnostic] OK: no express imports or src/express/ reach-ins outside src/express/');
