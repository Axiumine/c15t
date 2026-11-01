// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { compare, main, measure, scan } from './check-code-caps.ts';

/*
 * scripts/check-code-caps.ts against throwaway source trees. This file uses node:test (not Vitest),
 * because Node's own coverage report is what proves that the script is covered at 100% on lines,
 * branches and functions: `yarn test:scripts-coverage`. Vitest's `scripts` project excludes it.
 */

const SCRIPT = resolve(import.meta.dirname, 'check-code-caps.ts');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A source tree in a temporary directory: `files` maps a relative path to its content. */
function tree(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'code-caps-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Runs `main` in process and collects what it prints. */
function run(root, ...argv) {
  const out = [];
  const err = [];
  const code = main(argv, root, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join(''), err: err.join('') };
}

const BASELINE = '.code-caps-baseline.json';
const baselineOf = (root) => JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));

/** `lines` lines of a function named `name` (header, body, closing brace). */
const func = (name, lines, params = '') =>
  `function ${name}(${params}) {\n${'  work();\n'.repeat(lines - 2)}}\n`;

/** The violations of `measure`, as `kind name value` strings. */
const found = (path, text) => measure(path, text).map((v) => `${v.kind} ${v.name} ${v.value}`);

const WRAP = {
  if: (body) => `if (a) { ${body} }`,
  for: (body) => `for (;;) { ${body} }`,
  forIn: (body) => `for (const key in object) { ${body} }`,
  forOf: (body) => `for (const item of list) { ${body} }`,
  while: (body) => `while (a) { ${body} }`,
  do: (body) => `do { ${body} } while (a);`,
  switch: (body) => `switch (a) { case 1: ${body} }`,
  try: (body) => `try { ${body} } catch { work(); }`,
};

/** Statements of the given kinds, each inside the previous one, around `inner`. */
const nested = (kinds, inner = 'work();') =>
  kinds.reduceRight((body, kind) => WRAP[kind](body), inner);

describe('file length', () => {
  test('500 lines are fine, with or without a trailing newline', () => {
    const lines = Array.from({ length: 500 }, () => '// line').join('\n');
    assert.deepEqual(found('a.ts', lines), []);
    assert.deepEqual(found('a.ts', `${lines}\n`), []);
  });

  test('501 lines are over the cap', () => {
    const lines = Array.from({ length: 501 }, () => '// line').join('\n');
    assert.deepEqual(found('a.ts', lines), ['file-lines (file) 501']);
    assert.deepEqual(found('a.ts', `${lines}\n`), ['file-lines (file) 501']);
  });
});

describe('function length', () => {
  test('50 lines are fine and 51 are not', () => {
    assert.deepEqual(found('a.ts', func('fits', 50)), []);
    assert.deepEqual(found('a.ts', func('toolong', 51)), ['function-lines toolong 51']);
  });

  test('the span starts at the code, not at a preceding comment', () => {
    const text = `/**\n * A long doc comment.\n${' *\n'.repeat(60)} */\n${func('documented', 50)}`;
    assert.deepEqual(found('a.ts', text), []);
  });

  test('names follow the declaration kind', () => {
    const body = `{\n${'  work();\n'.repeat(60)}}`;
    const text = [
      `const arrow = () => ${body};`,
      `const expression = function () ${body};`,
      `const holder = { method() ${body}, property: () => ${body} };`,
      `class Box { constructor() ${body} run() ${body} get size() ${body} set size(_v) ${body} }`,
      `run(() => ${body});`,
      `function outer() { function inner() ${body} }`,
    ].join('\n');
    const kinds = found('a.ts', text)
      .filter((entry) => !entry.startsWith('file-lines'))
      .map((entry) => entry.replace(/ \d+$/, ''));
    assert.deepEqual(kinds, [
      'function-lines arrow',
      'function-lines expression',
      'function-lines method',
      'function-lines property',
      'function-lines Box.constructor',
      'function-lines Box.run',
      'function-lines Box.size',
      'function-lines Box.size#2',
      'function-lines <anonymous>',
      'function-lines outer',
      'function-lines outer.inner',
    ]);
  });

  test('a repeated name gets a number, so every key is unique', () => {
    const text = `${func('same', 51)}\n${func('same', 52)}\n${func('same', 53)}`;
    assert.deepEqual(found('a.ts', text), [
      'function-lines same 51',
      'function-lines same#2 52',
      'function-lines same#3 53',
    ]);
  });

  test('signatures without a body are not functions', () => {
    const text = [
      'function overloaded(a: string, b: string, c: string, d: string, e: string): void;',
      'function overloaded(a: number): void;',
      'function overloaded() {}',
      'interface Shape { area(a: number, b: number, c: number, d: number, e: number): number }',
      'type Callback = (a: number, b: number, c: number, d: number, e: number) => void;',
    ].join('\n');
    assert.deepEqual(found('a.ts', text), []);
  });

  test('a .tsx file is measured as TSX', () => {
    const rows = '    <li>row</li>\n'.repeat(50);
    const text = `export function List() {\n  return (\n  <ul>\n${rows}  </ul>\n  );\n}\n`;
    assert.deepEqual(found('list.tsx', text), ['function-lines List 56']);
  });
});

describe('parameters', () => {
  test('4 are fine and 5 are not', () => {
    assert.deepEqual(found('a.ts', 'function four(a, b, c, d) {}'), []);
    assert.deepEqual(found('a.ts', 'function five(a, b, c, d, e) {}'), ['params five 5']);
  });

  test('a `this` parameter is not counted', () => {
    assert.deepEqual(found('a.ts', 'function bound(this: Window, a, b, c, d) {}'), []);
  });
});

describe('nesting', () => {
  const inFunction = (kinds, inner) => `function deep() { ${nested(kinds, inner)} }`;
  const FOUR = ['if', 'for', 'while', 'try'];

  test('depth 4 is fine and depth 5 is not', () => {
    assert.deepEqual(found('a.ts', inFunction(FOUR)), []);
    assert.deepEqual(found('a.ts', inFunction([...FOUR, 'if'])), ['nesting deep 5']);
  });

  test('every kind of control statement opens a level', () => {
    for (const kind of ['for', 'forIn', 'forOf', 'while', 'do', 'switch', 'try', 'if']) {
      assert.deepEqual(found('a.ts', inFunction(Array(5).fill(kind))), ['nesting deep 5'], kind);
      assert.deepEqual(found('a.ts', inFunction(Array(4).fill(kind))), [], kind);
    }
  });

  test('else-if keeps the level, an if without braces opens one', () => {
    const chain =
      'if (a) { work(); } else if (b) { work(); } else if (c) { work(); } else { work(); }';
    assert.deepEqual(found('a.ts', inFunction(['if', 'for', 'while'], chain)), []);
    const unbraced = 'if (a) if (b) if (c) if (d) if (e) work();';
    assert.deepEqual(found('a.ts', `function deep() { ${unbraced} }`), ['nesting deep 5']);
  });

  test('an if inside the else block of an if is a new level', () => {
    const text =
      'function deep() { if (a) { work(); } else { if (b) { if (c) { if (d) { if (e) { work(); } } } } } }';
    assert.deepEqual(found('a.ts', text), ['nesting deep 5']);
  });

  test('a nested function starts counting again, and reports under its own name', () => {
    const inner = 'const f = () => { work(); };';
    assert.deepEqual(found('a.ts', `function outer() { ${nested(FOUR, inner)} }`), []);
    const deep = `const inner = () => { ${nested([...FOUR, 'if'])} };`;
    assert.deepEqual(found('a.ts', `function outer() { ${deep} }`), ['nesting outer.inner 5']);
  });

  test('a class member is measured as its own function', () => {
    assert.deepEqual(found('a.ts', `class K { run() { ${nested([...FOUR, 'if'])} } }`), [
      'nesting K.run 5',
    ]);
  });

  test('statements outside any function are not measured', () => {
    assert.deepEqual(found('a.ts', nested([...FOUR, 'if', 'if'])), []);
  });
});

describe('class length', () => {
  const classOf = (head, lines) => `${head} {\n${'  field = 1;\n'.repeat(lines - 2)}}\n`;

  test('300 lines are fine and 301 are not', () => {
    assert.deepEqual(found('a.ts', classOf('class Fits', 300)), []);
    assert.deepEqual(found('a.ts', classOf('class Big', 301)), ['class-lines Big 301']);
  });

  test('class expressions are named by their variable, or anonymous', () => {
    assert.deepEqual(found('a.ts', `const Named = ${classOf('class', 301)};`), [
      'class-lines Named 301',
    ]);
    assert.deepEqual(found('a.ts', `use(${classOf('class', 301)});`), [
      'class-lines <anonymous> 301',
    ]);
  });
});

describe('what is scanned', () => {
  const long = Array.from({ length: 501 }, () => '// line').join('\n');
  const bad = `${func('big', 60, 'a, b, c, d, e')}\n${func('deep', 5, '').replace('work();', nested(Array(5).fill('if')))}`;

  test('production code is measured on every cap', () => {
    assert.deepEqual(found('a.ts', bad), [
      'function-lines big 60',
      'params big 5',
      'nesting deep 5',
    ]);
  });

  test('test files only count towards the file cap', () => {
    for (const path of ['a.test.ts', 'a.spec.tsx', 'src/testing/helper.ts', 'src/test/helper.ts']) {
      const kinds = measure(path, `${bad}\n${long}`).map((violation) => violation.kind);
      assert.deepEqual(kinds, ['file-lines'], path);
    }
  });

  test('scan walks apps/*/src, packages/*/src and scripts, and skips generated files and declarations', () => {
    const root = tree({
      'apps/web/src/screen.tsx': func('screen', 51),
      'apps/web/src/routeTree.gen.ts': func('generatedRoutes', 99),
      'apps/web/src/nested/deeper/util.ts': func('util', 52),
      'packages/db/src/c15t.generated.ts': func('generatedTypes', 99),
      'packages/db/src/types.d.ts': func('declared', 99),
      'packages/db/src/query.ts': func('query', 53),
      'scripts/tool.ts': func('tool', 54),
      'scripts/tool.mjs': func('plainJs', 99),
      'apps/web/vite.config.ts': func('config', 99),
      'e2e/flow.ts': func('flow', 99),
      'docs/example.ts': func('example', 99),
    });
    assert.deepEqual(
      scan(root).map((v) => `${v.path} ${v.name}`),
      [
        'apps/web/src/nested/deeper/util.ts util',
        'apps/web/src/screen.tsx screen',
        'packages/db/src/query.ts query',
        'scripts/tool.ts tool',
      ],
    );
  });

  test('scan of an empty tree is empty', () => {
    assert.deepEqual(scan(tree()), []);
  });
});

describe('compare', () => {
  const v = (name, value, kind = 'function-lines') => ({ path: 'a.ts', kind, name, value });

  test('equal violations are not a change', () => {
    assert.deepEqual(compare([v('f', 60)], [v('f', 60)]), []);
    assert.deepEqual(compare([], []), []);
  });

  test('new, grown, shrunk and fixed violations', () => {
    const baseline = [v('grows', 60), v('shrinks', 70), v('fixed', 80), v('same', 90)];
    const current = [
      v('grows', 61),
      v('shrinks', 55),
      v('same', 90),
      v('fresh', 52),
      v('p', 5, 'params'),
    ];
    const change = (type, name, before, now, kind = 'function-lines') => ({
      type,
      path: 'a.ts',
      kind,
      name,
      before,
      now,
    });
    assert.deepEqual(compare(baseline, current), [
      change('grew', 'grows', 60, 61),
      change('shrank', 'shrinks', 70, 55),
      change('new', 'fresh', undefined, 52),
      change('new', 'p', undefined, 5, 'params'),
      change('fixed', 'fixed', 80, undefined),
    ]);
  });

  test('the same name under another kind or path is another violation', () => {
    const other = { ...v('f', 60), path: 'b.ts' };
    const changes = compare([v('f', 60)], [v('f', 60, 'params'), other]);
    assert.deepEqual(
      changes.map((c) => `${c.type} ${c.path} ${c.kind}`),
      ['new a.ts params', 'new b.ts function-lines', 'fixed a.ts function-lines'],
    );
  });
});

describe('the ratchet', () => {
  const source = (name, lines) => ({ 'apps/web/src/code.ts': func(name, lines) });

  test('a repository without violations passes', () => {
    const root = tree({ 'apps/web/src/ok.ts': func('small', 10) });
    assert.equal(run(root, '--update').code, 0);
    assert.deepEqual(baselineOf(root), []);
    const result = run(root);
    assert.equal(result.code, 0);
    assert.equal(result.out, 'code-caps: ok\n');
    assert.equal(result.err, '');
  });

  test('a missing baseline fails, and --update creates it', () => {
    const root = tree(source('big', 60));
    const missing = run(root);
    assert.equal(missing.code, 1);
    assert.match(
      missing.err,
      /No \.code-caps-baseline\.json\. Create it with: node scripts\/check-code-caps\.ts --update/,
    );
    const created = run(root, '--update');
    assert.equal(created.code, 0);
    assert.match(created.out, /wrote \.code-caps-baseline\.json with 1 violations/);
    assert.deepEqual(baselineOf(root), [
      { path: 'apps/web/src/code.ts', kind: 'function-lines', name: 'big', value: 60 },
    ]);
    assert.equal(run(root).code, 0);
  });

  test('a new violation fails and is listed in a table', () => {
    const root = tree(source('big', 60));
    run(root, '--update');
    writeFileSync(join(root, 'apps/web/src/more.ts'), func('worse', 70, 'a, b, c, d, e'));
    const result = run(root);
    assert.equal(result.code, 1);
    assert.match(result.err, /Over the caps, and new or worse than the baseline:/);
    assert.match(result.err, /change\s+where\s+baseline\s+now\s+cap/);
    assert.match(result.err, /new\s+apps\/web\/src\/more\.ts function-lines worse\s+-\s+70\s+50/);
    assert.match(result.err, /new\s+apps\/web\/src\/more\.ts params worse\s+-\s+5\s+4/);
    assert.match(result.err, /code-caps: failed/);
    assert.equal(result.out, '');
  });

  test('a violation that grew fails', () => {
    const root = tree(source('big', 60));
    run(root, '--update');
    writeFileSync(join(root, 'apps/web/src/code.ts'), func('big', 61));
    const result = run(root);
    assert.equal(result.code, 1);
    assert.match(result.err, /grew\s+apps\/web\/src\/code\.ts function-lines big\s+60\s+61\s+50/);
  });

  test('a violation that shrank or vanished is reported, not failed', () => {
    const root = tree({ ...source('shrinks', 60), 'apps/web/src/gone.ts': func('goes', 70) });
    run(root, '--update');
    writeFileSync(join(root, 'apps/web/src/code.ts'), func('shrinks', 55));
    writeFileSync(join(root, 'apps/web/src/gone.ts'), func('goes', 10));
    const before = readFileSync(join(root, BASELINE), 'utf8');
    const result = run(root);
    assert.equal(result.code, 0);
    assert.match(result.out, /Better than the baseline:/);
    assert.match(
      result.out,
      /shrank\s+apps\/web\/src\/code\.ts function-lines shrinks\s+60\s+55\s+50/,
    );
    assert.match(result.out, /fixed\s+apps\/web\/src\/gone\.ts function-lines goes\s+70\s+-\s+50/);
    assert.match(result.out, /Run with --update to lower the baseline\./);
    assert.match(result.out, /code-caps: ok/);
    assert.equal(readFileSync(join(root, BASELINE), 'utf8'), before, 'the check never writes');
  });

  test('--update lowers the baseline', () => {
    const root = tree({ ...source('shrinks', 60), 'apps/web/src/gone.ts': func('goes', 70) });
    run(root, '--update');
    writeFileSync(join(root, 'apps/web/src/code.ts'), func('shrinks', 55));
    writeFileSync(join(root, 'apps/web/src/gone.ts'), func('goes', 10));
    const result = run(root, '--update');
    assert.equal(result.code, 0);
    assert.match(result.out, /Better than the baseline:/);
    assert.doesNotMatch(result.out, /Run with --update/);
    assert.match(result.out, /wrote \.code-caps-baseline\.json with 1 violations/);
    assert.deepEqual(baselineOf(root), [
      { path: 'apps/web/src/code.ts', kind: 'function-lines', name: 'shrinks', value: 55 },
    ]);
  });

  test('--update without any change rewrites the same file', () => {
    const root = tree(source('big', 60));
    run(root, '--update');
    const before = readFileSync(join(root, BASELINE), 'utf8');
    const result = run(root, '--update');
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.out, /Better than the baseline/);
    assert.equal(readFileSync(join(root, BASELINE), 'utf8'), before);
  });

  test('--update refuses to raise the baseline', () => {
    const root = tree(source('big', 60));
    run(root, '--update');
    const before = readFileSync(join(root, BASELINE), 'utf8');
    writeFileSync(join(root, 'apps/web/src/code.ts'), func('big', 65));
    writeFileSync(join(root, 'apps/web/src/more.ts'), func('fresh', 51));
    const result = run(root, '--update');
    assert.equal(result.code, 1);
    assert.match(result.err, /grew\s+apps\/web\/src\/code\.ts function-lines big\s+60\s+65/);
    assert.match(result.err, /new\s+apps\/web\/src\/more\.ts function-lines fresh/);
    assert.match(result.err, /Refusing to raise the baseline: fix the code instead\./);
    assert.equal(
      readFileSync(join(root, BASELINE), 'utf8'),
      before,
      'the baseline stays as it was',
    );
  });

  test('arguments other than --update print the usage and exit with 2', () => {
    const root = tree();
    for (const argv of [
      ['--bogus'],
      ['--update', '--bogus'],
      ['--update', '--update'],
      ['extra'],
    ]) {
      const result = run(root, ...argv);
      assert.equal(result.code, 2, argv.join(' '));
      assert.equal(result.err, 'usage: node scripts/check-code-caps.ts [--update]\n');
      assert.equal(result.out, '');
    }
  });
});

describe('the command line', () => {
  /** The real entry point, in a child process, as `node scripts/check-code-caps.ts` runs it. */
  const cli = (root, ...argv) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: root, encoding: 'utf8' });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };

  test('exits 0 and prints to stdout when the caps hold', () => {
    const root = tree({ 'apps/web/src/big.ts': func('big', 60) });
    const created = cli(root, '--update');
    assert.equal(created.code, 0);
    assert.match(created.out, /wrote \.code-caps-baseline\.json with 1 violations/);
    const checked = cli(root);
    assert.equal(checked.code, 0);
    assert.equal(checked.out, 'code-caps: ok\n');
    assert.equal(checked.err, '');
  });

  test('exits 1 and prints to stderr when a cap is broken', () => {
    const root = tree({ 'apps/web/src/big.ts': func('big', 60) });
    cli(root, '--update');
    writeFileSync(join(root, 'apps/web/src/big.ts'), func('big', 61));
    const checked = cli(root);
    assert.equal(checked.code, 1);
    assert.match(checked.err, /grew\s+apps\/web\/src\/big\.ts function-lines big\s+60\s+61\s+50/);
    assert.match(checked.err, /code-caps: failed/);
  });

  test('exits 2 for an unknown argument', () => {
    const result = cli(tree(), '--nope');
    assert.equal(result.code, 2);
    assert.match(result.err, /usage: node scripts\/check-code-caps\.ts \[--update\]/);
  });
});
