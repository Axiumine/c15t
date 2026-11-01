// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/** Everything one e2e run needs to know about itself; `runtime()` in runtime.ts builds it. */
export interface Runtime {
  /** `e2e-<8 hex>`. Prefix of every site key, hostname and email the run creates. */
  readonly runId: string;
  /** The loopback address of this machine, read from the network interfaces. */
  readonly loopback: string;
  /** A second loopback address: nginx binds it as its source address towards consent-api. */
  readonly proxyAddress: string;
  readonly ports: {
    readonly consentApi: number;
    readonly dashboardApi: number;
    readonly web: number;
    readonly nginx: number;
  };
  /** Scratch space of the run (built SPA, site files, state). Removed by the teardown. */
  readonly runDir: string;
  readonly webDist: string;
  readonly siteDir: string;
  readonly stateFile: string;
  /** What the browser uses for the dashboard; equals `BETTER_AUTH_URL` of dashboard-api. */
  readonly dashboardOrigin: string;
  readonly consentApiOrigin: string;
  readonly dashboardApiOrigin: string;
  readonly nginxOrigin: string;
  /** docker compose project name, unique per run. */
  readonly composeProject: string;
}
