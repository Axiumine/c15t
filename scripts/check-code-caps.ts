// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * `yarn code-caps`: size and shape caps for the hand-written TypeScript, with a ratchet.
 *
 * Caps: file 500 lines, function 50 lines, class 300 lines, 4 parameters, nesting depth 4. Code that
 * is over a cap today is recorded in .code-caps-baseline.json. The check fails for a violation that
 * is not in the baseline or whose value grew, and only reports one that shrank or vanished.
 * `--update` rewrites the baseline, and refuses to raise it.
 *
 * Scope: the src folders of apps/<name> and packages/<name>, and scripts/, without generated files
 * and declarations. Test files (and src/test, src/testing) only count towards the file cap: their
 * bodies are nested describe/test callbacks, so function length and nesting there would measure the
 * number of cases, not complexity.
 *
 * This file is the command line. The parts live in scripts/code-caps/: types.ts (the caps and the
 * shapes), ast.ts and walk.ts (the TypeScript syntax tree), measure.ts (one file), compare.ts
 * (against the baseline), scan.ts (the repository), baseline.ts, report.ts and run.ts.
 */
import { compare } from './code-caps/compare.ts';
import { measure } from './code-caps/measure.ts';
import { run } from './code-caps/run.ts';
import { scan } from './code-caps/scan.ts';
import type { Change, Io, Kind, Violation } from './code-caps/types.ts';

export type { Change, Kind, Violation };
export { compare, measure, scan };

const USAGE = 'usage: node scripts/check-code-caps.ts [--update]\n';

/** Runs the tool for `argv` (flags only) in the repository at `root` and returns the exit code. */
export function main(argv: readonly string[], root: string, io: Io): number {
  const update = argv.includes('--update');
  if (argv.length > (update ? 1 : 0)) {
    io.err(USAGE);
    return 2;
  }
  const code = run(update, root, io);
  if (code === 0 && !update) io.out('code-caps: ok\n');
  return code;
}

if (import.meta.main) {
  const io: Io = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
  process.exitCode = main(process.argv.slice(2), process.cwd(), io);
}
