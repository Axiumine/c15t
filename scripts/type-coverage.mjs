// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * `yarn type-coverage`: run `type-coverage` once for every project the root tsconfig.json
 * references. The CLI takes a single tsconfig, and the root one only lists references, so this
 * keeps a new workspace covered without editing a script. The threshold (100), strict mode and
 * the ignored generated files live in the `typeCoverage` field of package.json.
 *
 * Two relaxations, each for a reason:
 * - Test projects (`tsconfig.test.json`) and the tooling project (`tsconfig.tools.json`) may use
 *   type assertions, because a test double has to be cast to the interface it stands in for. A
 *   real `any` still fails there. Production projects (`tsconfig.json`) count assertions too.
 * - dashboard-web and the tooling project (which holds the Playwright specs) ignore `any` inside
 *   type arguments: TanStack Router's generics default several of them to `any`, so every router
 *   type (`useRouter()`, `createRouter()`) has one, and Playwright's `APIResponse<TJson = any>`
 *   is `APIResponse<any>` wherever a spec asks for a response.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ASSERTIONS_OK = [
  '--ignore-as-assertion',
  '--ignore-type-assertion',
  '--ignore-non-null-assertion',
];

function flagsFor(project) {
  const flags = project.endsWith('/tsconfig.json') ? [] : ASSERTIONS_OK;
  const libraryDefaultsAny = project.includes('dashboard-web') || project.endsWith('.tools.json');
  return libraryDefaultsAny ? [...flags, '--ignore-nested'] : flags;
}

// Projects import each other through `dist/*.d.ts`, so build those first (an incremental no-op
// when `yarn typecheck` just ran).
const build = spawnSync('tsc', ['-b'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const { references } = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
const projects = references.map(({ path }) =>
  path.endsWith('.json') ? path : `${path}/tsconfig.json`,
);

let failed = 0;
for (const project of projects) {
  process.stdout.write(`type-coverage ${project}\n`);
  const args = ['-p', project, '--show-relative-path', ...flagsFor(project)];
  if (spawnSync('type-coverage', args, { stdio: 'inherit' }).status !== 0) failed += 1;
}
if (failed > 0) {
  process.stderr.write(
    `type-coverage: ${failed} of ${projects.length} projects are below the threshold\n`,
  );
  process.exit(1);
}
process.stdout.write(`type-coverage: all ${projects.length} projects at the threshold\n`);
