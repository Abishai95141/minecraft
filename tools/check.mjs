#!/usr/bin/env node
// The gate. Run this after touching anything under src/.
//
//   node tools/check.mjs                 check every module
//   node tools/check.mjs src/a.js ...    check only these (plus their imports)
//   node tools/check.mjs --syntax        syntax pass only (deps may not exist yet)
//
// Three passes, cheapest first:
//   1. syntax   — parses each file as an ES module
//   2. imports  — every import path resolves, every imported name is exported
//   3. load     — actually imports the module graph under a browser shim, which
//                 catches TDZ errors, bad top-level initialisation and circular
//                 imports that only bite at runtime
//
// Exit code is non-zero when anything fails, so it works as a build gate.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative, join, extname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const TMP = join(ROOT, '.check-tmp');

const args = process.argv.slice(2);
const syntaxOnly = args.includes('--syntax');
const quiet = args.includes('--quiet');
const targets = args.filter((a) => !a.startsWith('--'));

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';

// ---------------------------------------------------------------- discovery

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.js') out.push(p);
  }
  return out;
}

const allFiles = walk(SRC).sort();
const files = targets.length
  ? targets.map((t) => resolve(ROOT, t)).filter((f) => existsSync(f))
  : allFiles;

if (targets.length && files.length !== targets.length) {
  for (const t of targets) {
    if (!existsSync(resolve(ROOT, t))) console.error(`${RED}missing file:${OFF} ${t}`);
  }
}

const rel = (f) => relative(ROOT, f).split('\\').join('/');
const failures = [];
const fail = (file, pass, message) => failures.push({ file: rel(file), pass, message });

// ---------------------------------------------------------------- pass 1: syntax

// `node --check` parses .js as CommonJS, so ESM sources are copied to a .mjs
// twin first. That twin is only ever parsed, never executed.
function syntaxCheck(file) {
  mkdirSync(TMP, { recursive: true });
  const tmp = join(TMP, 'probe.mjs');
  writeFileSync(tmp, readFileSync(file, 'utf8'));
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    return null;
  } catch (e) {
    const out = (e.stderr?.toString() || e.stdout?.toString() || e.message || '').trim();
    // Rewrite the temp path back to the real one so the message is actionable.
    return out.split('\n').slice(0, 12).join('\n').split(tmp).join(rel(file));
  }
}

// ---------------------------------------------------------------- pass 2: imports

const IMPORT_RE = /^\s*(?:import|export)\s+(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;

/** Names an ES module source file exports, parsed statically. */
function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/^\s*export\s+default\b/m.test(src)) names.add('default');
  if (/^\s*export\s*\*\s*from/m.test(src)) names.add('*');
  return names;
}

/** Named bindings an import statement pulls in, ignoring namespace/default forms. */
function importedNames(clause) {
  const out = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return out;
  for (const part of braces[1].split(',')) {
    const t = part.trim();
    if (!t) continue;
    out.push(t.split(/\s+as\s+/)[0].trim());
  }
  return out;
}

function importCheck(file) {
  const src = readFileSync(file, 'utf8');
  const dir = dirname(file);
  const problems = [];

  const specs = [];
  for (const m of src.matchAll(IMPORT_RE)) specs.push({ spec: m[1], clause: m[0] });
  for (const m of src.matchAll(BARE_IMPORT_RE)) specs.push({ spec: m[1], clause: '' });

  for (const { spec, clause } of specs) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      problems.push(`bare import "${spec}" — no bundler and no npm; only relative paths are allowed`);
      continue;
    }
    if (!spec.endsWith('.js')) {
      problems.push(`import "${spec}" is missing the .js extension (browsers do not resolve extensions)`);
      continue;
    }
    const target = resolve(dir, spec);
    if (!existsSync(target)) {
      problems.push(`import "${spec}" resolves to ${rel(target)}, which does not exist`);
      continue;
    }
    const targetExports = exportedNames(readFileSync(target, 'utf8'));
    if (targetExports.has('*')) continue;      // re-export, cannot resolve statically
    for (const name of importedNames(clause)) {
      if (!targetExports.has(name)) {
        problems.push(`imports { ${name} } from "${spec}", but that file does not export it`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- run

const t0 = Date.now();
let checked = 0;

for (const f of files) {
  const err = syntaxCheck(f);
  if (err) fail(f, 'syntax', err);
  checked++;
}
rmSync(TMP, { recursive: true, force: true });

if (!syntaxOnly) {
  for (const f of files) {
    if (failures.some((x) => x.file === rel(f))) continue;   // already broken
    for (const p of importCheck(f)) fail(f, 'imports', p);
  }
}

// Pass 3 only makes sense once nothing is structurally broken, because a bad
// import aborts the whole graph load.
if (!syntaxOnly && failures.length === 0) {
  const { installBrowserEnv } = await import('./env.mjs');
  installBrowserEnv();

  // Load leaves first so a failure names the module that actually broke.
  const order = (f) => {
    const p = rel(f);
    if (p.includes('/core/')) return 0;
    if (p.includes('/world/')) return 1;
    if (p.includes('/item/')) return 2;
    if (p.includes('/entity/')) return 3;
    if (p.includes('/render/')) return 4;
    if (p.includes('/audio/')) return 5;
    if (p.includes('/ui/')) return 6;
    if (p.includes('/story/')) return 7;
    return 8;
  };
  const loadOrder = [...files].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  for (const f of loadOrder) {
    try {
      await import(pathToFileURL(f).href);
    } catch (e) {
      const stack = (e && e.stack ? e.stack : String(e)).split('\n').slice(0, 8).join('\n');
      fail(f, 'load', stack.split(ROOT + '/').join(''));
    }
  }
}

// ---------------------------------------------------------------- report

const ms = Date.now() - t0;
if (failures.length === 0) {
  if (!quiet) {
    console.log(`${GREEN}OK${OFF} ${checked} module${checked === 1 ? '' : 's'} — syntax, imports${syntaxOnly ? '' : ' and load'} clean ${DIM}(${ms}ms)${OFF}`);
  }
  process.exit(0);
}

const byFile = new Map();
for (const f of failures) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

console.error(`${RED}FAILED${OFF} ${byFile.size} of ${checked} module${checked === 1 ? '' : 's'} ${DIM}(${ms}ms)${OFF}\n`);
for (const [file, list] of byFile) {
  console.error(`${YELLOW}${file}${OFF}`);
  for (const f of list) {
    console.error(`  ${RED}[${f.pass}]${OFF} ${f.message.split('\n').join('\n  ')}`);
  }
  console.error('');
}
process.exit(1);
