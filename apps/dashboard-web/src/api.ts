// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { AppType } from '@consent/dashboard-api';
import {
  apiErrorSchema,
  type BanUserInput,
  type ErrorCode,
  type Issue,
  type SiteCreateInput,
  type SiteUpdate,
  type UserCreateInput,
  type UserUpdate,
} from '@consent/shared';
import {
  infiniteQueryOptions,
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { hc } from 'hono/client';
import type { DateRange } from './lib/range';

export const API_BASE = '/api';

/* ---------------------------------------------------------------------------------------------
 * Errors. dashboard-api answers `{ error: { code, message } }`; nginx and Cloudflare can answer
 * with other bodies (a plain 502, an HTML page), so the status decides the kind first.
 * ------------------------------------------------------------------------------------------- */

export type ApiErrorKind =
  | 'unauthorized'
  | 'password-change-required'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'rate-limited'
  | 'unavailable'
  | 'network'
  | 'unknown';

export interface ApiErrorInit {
  readonly status: number;
  readonly code?: ErrorCode | undefined;
  readonly message?: string | undefined;
  readonly issues?: readonly Issue[] | undefined;
  readonly kind?: ApiErrorKind | undefined;
}

const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

function classify(status: number, code: ErrorCode | undefined): ApiErrorKind {
  if (code === 'PASSWORD_CHANGE_REQUIRED') return 'password-change-required';
  if (code === 'SERVICE_UNAVAILABLE' || UNAVAILABLE_STATUSES.has(status)) return 'unavailable';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status === 409) return 'conflict';
  if (status === 400) return 'validation';
  return 'unknown';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly kind: ApiErrorKind;
  readonly issues: readonly Issue[];

  constructor(init: ApiErrorInit) {
    super(init.message ?? `Request failed (${init.status})`);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind ?? classify(init.status, init.code);
    this.issues = init.issues ?? [];
  }
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) return new ApiError({ status: response.status });
  const { code, message, issues } = parsed.data.error;
  return new ApiError({ status: response.status, code, message, issues });
}

const FRIENDLY: Readonly<Record<ApiErrorKind, string>> = {
  unauthorized: 'Your session has ended. Sign in again.',
  'password-change-required': 'You must change your password before continuing.',
  forbidden: 'You are not allowed to do this.',
  'not-found': 'This could not be found.',
  validation: 'Some of the values are not valid.',
  conflict: 'This conflicts with the current state.',
  'rate-limited': 'Too many requests. Wait a moment and try again.',
  unavailable: 'The service is temporarily unavailable. Try again in a moment.',
  network: 'Cannot reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
};

/** Text that is safe to show: server messages only for codes where the user can act on them. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return FRIENDLY.unknown;
  const specific =
    error.kind === 'validation' || error.kind === 'conflict' || error.kind === 'forbidden';
  return specific && error.message !== '' && error.code !== undefined
    ? error.message
    : FRIENDLY[error.kind];
}

export const isUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && (error.kind === 'unavailable' || error.kind === 'network');

/** Field errors by path, for pushing a server-side VALIDATION_ERROR back into a form. */
export function fieldIssues(error: unknown): readonly Issue[] {
  return error instanceof ApiError ? error.issues : [];
}

/* ---------------------------------------------------------------------------------------------
 * Client. Every non-2xx response and every network failure becomes an ApiError inside the fetch
 * wrapper, so a resolved hc call is always a success.
 * ------------------------------------------------------------------------------------------- */

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await globalThis.fetch(input, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({ status: 0, kind: 'network' });
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response;
}

export const client = hc<AppType>(API_BASE, {
  fetch: apiFetch,
  init: { credentials: 'include' },
});

/* ---------------------------------------------------------------------------------------------
 * Query client: 401 sends the user to the login screen, PASSWORD_CHANGE_REQUIRED to the forced
 * change-password screen. Only reads are retried, and only when the service is unavailable.
 * ------------------------------------------------------------------------------------------- */

export interface SessionHandlers {
  readonly onUnauthorized: () => void;
  readonly onPasswordChangeRequired: () => void;
}

const MAX_READ_RETRIES = 2;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return isUnavailable(error) && failureCount < MAX_READ_RETRIES;
}

export function createQueryClient(handlers: SessionHandlers): QueryClient {
  const onError = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.kind === 'unauthorized') handlers.onUnauthorized();
    else if (error.kind === 'password-change-required') handlers.onPasswordChangeRequired();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/* ---------------------------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------------------------- */

export const queryKeys = {
  me: ['me'] as const,
  sites: ['sites'] as const,
  site: (siteKey: string) => ['sites', siteKey] as const,
  stats: (siteKey: string, range: DateRange) => ['sites', siteKey, 'stats', range] as const,
  consents: (siteKey: string, filters: ConsentFilters) =>
    ['sites', siteKey, 'consents', filters] as const,
  adminSites: ['admin', 'sites'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminAudit: ['admin', 'audit'] as const,
};

export const meQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.me,
    queryFn: async () => (await client.me.$get()).json(),
  });

export const sitesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.sites,
    queryFn: async () => (await client.sites.$get()).json(),
  });

export const siteQueryOptions = (siteKey: string) =>
  queryOptions({
    queryKey: queryKeys.site(siteKey),
    queryFn: async () => (await client.sites[':siteKey'].$get({ param: { siteKey } })).json(),
  });

export const statsQueryOptions = (siteKey: string, range: DateRange) =>
  queryOptions({
    queryKey: queryKeys.stats(siteKey, range),
    queryFn: async () =>
      (await client.sites[':siteKey'].stats.$get({ param: { siteKey }, query: range })).json(),
  });

export const useMe = () => useQuery(meQueryOptions());
export const useSites = () => useQuery(sitesQueryOptions());
export const useSite = (siteKey: string) => useQuery(siteQueryOptions(siteKey));

/** Keeps the previous chart on screen while another range loads (no skeleton flash). */
export const useSiteStats = (siteKey: string, range: DateRange) =>
  useQuery({ ...statsQueryOptions(siteKey, range), placeholderData: keepPreviousData });

export interface ConsentFilters {
  readonly subject?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

function consentQuery(filters: ConsentFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.subject !== undefined && filters.subject !== '') query['subject'] = filters.subject;
  if (filters.from !== undefined && filters.from !== '') query['from'] = filters.from;
  if (filters.to !== undefined && filters.to !== '') query['to'] = filters.to;
  return query;
}

export const useConsents = (siteKey: string, filters: ConsentFilters) =>
  useInfiniteQuery(
    infiniteQueryOptions({
      queryKey: queryKeys.consents(siteKey, filters),
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) =>
        (
          await client.sites[':siteKey'].consents.$get({
            param: { siteKey },
            query: {
              ...consentQuery(filters),
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          })
        ).json(),
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      placeholderData: keepPreviousData,
    }),
  );

/**
 * The export is a plain link: the browser streams the file to disk, so nothing is buffered in
 * memory, and the session cookie goes along because the request is same-origin.
 */
export function consentsCsvHref(siteKey: string, range: Partial<DateRange>): string {
  const query = new URLSearchParams();
  if (range.from !== undefined && range.from !== '') query.set('from', range.from);
  if (range.to !== undefined && range.to !== '') query.set('to', range.to);
  const suffix = query.size > 0 ? `?${query}` : '';
  return `${API_BASE}/sites/${encodeURIComponent(siteKey)}/consents.csv${suffix}`;
}

export const adminSitesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminSites,
    queryFn: async () => (await client.admin.sites.$get()).json(),
  });

export const adminUsersQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminUsers,
    queryFn: async () => (await client.admin.users.$get()).json(),
  });

export const useAdminSites = () => useQuery(adminSitesQueryOptions());
export const useAdminUsers = () => useQuery(adminUsersQueryOptions());

export const useAuditLog = () =>
  useInfiniteQuery(
    infiniteQueryOptions({
      queryKey: queryKeys.adminAudit,
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) =>
        (
          await client.admin.audit.$get({
            query: pageParam === undefined ? {} : { cursor: pageParam },
          })
        ).json(),
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );

/* ---------------------------------------------------------------------------------------------
 * Admin writes. Each one refreshes what it changed, and the audit log.
 * ------------------------------------------------------------------------------------------- */

/** A password the API returned once. It is handed to the caller and never stored by Query. */
export interface OneTimeSecret {
  readonly email: string;
  readonly password: string;
  readonly reason: 'created' | 'reset';
}

function useAdminMutation<Variables, Result>(
  mutationFn: (variables: Variables) => Promise<Result>,
  invalidate: readonly (readonly unknown[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(
        [...invalidate, queryKeys.adminAudit].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

const SITE_KEYS = [queryKeys.adminSites, queryKeys.sites] as const;

export const useCreateSite = () =>
  useAdminMutation(
    async (input: SiteCreateInput) => (await client.admin.sites.$post({ json: input })).json(),
    SITE_KEYS,
  );

export const useUpdateSite = () =>
  useAdminMutation(
    async (variables: { siteKey: string; changes: SiteUpdate }) =>
      (
        await client.admin.sites[':siteKey'].$patch({
          param: { siteKey: variables.siteKey },
          json: variables.changes,
        })
      ).json(),
    SITE_KEYS,
  );

export const useCreateUser = (onSecret: (secret: OneTimeSecret) => void) =>
  useAdminMutation(
    async (input: UserCreateInput) => {
      const result = await (await client.admin.users.$post({ json: input })).json();
      onSecret({ email: result.user.email, password: result.oneTimePassword, reason: 'created' });
      return result.user;
    },
    [queryKeys.adminUsers],
  );

export const useResetPassword = (onSecret: (secret: OneTimeSecret) => void) =>
  useAdminMutation(
    async (id: string) => {
      const result = await (
        await client.admin.users[':id']['reset-password'].$post({ param: { id } })
      ).json();
      onSecret({ email: result.user.email, password: result.oneTimePassword, reason: 'reset' });
      return result.user;
    },
    [queryKeys.adminUsers],
  );

export const useUpdateUser = () =>
  useAdminMutation(
    async (variables: { id: string; changes: UserUpdate }) =>
      (
        await client.admin.users[':id'].$patch({
          param: { id: variables.id },
          json: variables.changes,
        })
      ).json(),
    [queryKeys.adminUsers],
  );

export const useSetUserSites = () =>
  useAdminMutation(
    async (variables: { id: string; siteKeys: string[] }) =>
      (
        await client.admin.users[':id'].sites.$put({
          param: { id: variables.id },
          json: { siteKeys: variables.siteKeys },
        })
      ).json(),
    [queryKeys.adminUsers],
  );

export const useBanUser = () =>
  useAdminMutation(
    async (variables: { id: string; ban: BanUserInput }) =>
      (
        await client.admin.users[':id'].ban.$post({
          param: { id: variables.id },
          json: variables.ban,
        })
      ).json(),
    [queryKeys.adminUsers],
  );

export const useUnbanUser = () =>
  useAdminMutation(
    async (id: string) => (await client.admin.users[':id'].unban.$post({ param: { id } })).json(),
    [queryKeys.adminUsers],
  );

export const useRevokeSessions = () =>
  useAdminMutation(
    async (id: string) =>
      (await client.admin.users[':id']['revoke-sessions'].$post({ param: { id } })).json(),
    [queryKeys.adminUsers],
  );
