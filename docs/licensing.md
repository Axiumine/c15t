<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2026 Axiumine
-->

# Licensing

The project is licensed under the AGPL-3.0-or-later. The [License section of the README](../README.md#license) and the [`LICENSE`](../LICENSE) file state the license itself. This page explains what it means in practice and lists the third-party licenses.

**Why the AGPL.** consent-api and dashboard-api are network services. Under the plain GPL, someone could
modify them, run the modified version as a hosted service, and never share their changes, because
running software on a server is not "distributing" it. Section 13 of the AGPL closes that gap: if you
modify the program and let other people interact with it over a network, you must offer those users the
Corresponding Source of your modified version.

**What this means if you self-host it** (this is a plain-language summary, not legal advice):

- You run it unmodified, for your own websites: you have no extra obligation. Keep the license and
  copyright notices.
- You modify it and run your version where other people use it over the network (visitors whose
  browsers call `/api/c15t/*`, or the admins and users who log in to the dashboard): you must offer them
  the source of your modified version under the AGPL, for example through a link in the dashboard.
  Unmodified copies do not trigger section 13. This project does not ship a source-offer link today.
- Your websites are not affected. They talk to the consent API over HTTP, using c15t's own client
  libraries, which are separate packages under their own licenses. Nothing in this repository is
  linked into your website code.
- Contributions are accepted under the same license, with a DCO sign-off (see `CONTRIBUTING.md`). No
  dual licensing or contributor license agreement exists.

**Third-party licenses.** The dependencies are under licenses that are compatible with the AGPL-3.0, and
`dependency-review` in CI blocks pull requests that add an incompatible one. The key ones:

| Component | License |
|---|---|
| c15t (`@c15t/backend`, `@c15t/cli`, `@c15t/schema`) | Apache-2.0 |
| Hono, Better Auth, React, Vite, zod, Effect, TanStack, Tailwind CSS, Radix UI | MIT |
| Drizzle ORM | Apache-2.0 |
| postgres.js | Unlicense |
| Recharts (and its vendored d3 modules) | MIT, ISC, BSD-3-Clause |
| lightningcss (build time only) | MPL-2.0 |
| caniuse-lite data (build time only) | CC-BY-4.0 |

The minified dashboard-web bundle carries no license comments of its own, so `yarn build` writes the notices of the bundled dependencies to `apps/dashboard-web/dist/THIRD-PARTY-NOTICES.md`. It ships in the release tarball and in the deployed files, and `scripts/release-package.sh` refuses to pack a release without it.

MIT, BSD, ISC, Apache-2.0, Unlicense, MPL-2.0 and CC-BY-4.0 code can be combined into an AGPL-3.0
work. The reverse does not hold: anyone combining this project with their own code takes on the AGPL
terms for the combined work.
