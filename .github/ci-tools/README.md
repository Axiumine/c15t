# CI tools

Build tooling that only the GitHub Actions workflows use. It is not part of the application and
is not a Yarn workspace: `package.json` and `package-lock.json` here are read by `npm ci` alone.

| Package | Why |
|---|---|
| `corepack` | Node 25 and later no longer bundle Corepack. The package also ships the `yarn` shims, which fetch the Yarn release named in the root `packageManager` field. |
| `@cyclonedx/yarn-plugin-cyclonedx` | Generates the CycloneDX SBOMs of the release (`cyclonedx-yarn`). Works with Yarn 4 workspaces. |

`.github/actions/setup` installs them with `npm ci --prefix .github/ci-tools --ignore-scripts`, which
fails when a download does not match the integrity hash in `package-lock.json`, and adds
`.github/ci-tools/node_modules/.bin` to `PATH`. Dependabot (`npm`, directory `/.github/ci-tools`)
proposes updates.

To change a version by hand, edit `package.json`, then run
`npm install --package-lock-only --ignore-scripts --prefix .github/ci-tools` and commit both files.
