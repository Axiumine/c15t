// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * DDL of the c15t tables that dashboard-api reads, for the in-process Postgres (PGlite). The real
 * schema is owned by `c15t self-host migrate`; `ddl.test.ts` fails when this drifts from the
 * generated Drizzle types the queries are written against.
 */
export const C15T_DDL = `
create schema c15t;

create table c15t."subject" (
  "id" varchar(255) primary key,
  "externalId" text,
  "identityProvider" text,
  "tenantId" text,
  "createdAt" timestamp not null,
  "updatedAt" timestamp not null,
  "verifiedExternalId" text
);

create table c15t."domain" (
  "id" varchar(255) primary key,
  "name" text not null,
  "tenantId" text,
  "createdAt" timestamp not null,
  "updatedAt" timestamp not null
);

create table c15t."consentPolicy" (
  "id" varchar(255) primary key,
  "version" text not null,
  "type" text not null,
  "hash" text,
  "effectiveDate" timestamp not null,
  "isActive" boolean not null,
  "tenantId" text,
  "createdAt" timestamp not null
);

create table c15t."consentPurpose" (
  "id" varchar(255) primary key,
  "code" text not null,
  "tenantId" text,
  "createdAt" timestamp not null,
  "updatedAt" timestamp not null
);

create table c15t."runtimePolicyDecision" (
  "id" varchar(255) primary key,
  "tenantId" text,
  "policyId" text not null,
  "fingerprint" text not null,
  "matchedBy" text not null,
  "countryCode" text,
  "regionCode" text,
  "jurisdiction" text,
  "language" text,
  "model" text not null,
  "policyI18N" json,
  "uiMode" text,
  "bannerUi" json,
  "dialogUi" json,
  "categories" json,
  "preselectedCategories" json,
  "proofConfig" json,
  "dedupeKey" text not null,
  "createdAt" timestamp not null
);

create table c15t."consent" (
  "id" varchar(255) primary key,
  "subjectId" text not null references c15t."subject"("id"),
  "domainId" text not null references c15t."domain"("id"),
  "policyId" text references c15t."consentPolicy"("id"),
  "purposeIds" json not null,
  "metadata" json,
  "ipAddress" text,
  "userAgent" text,
  "givenAt" timestamp not null,
  "validUntil" timestamp,
  "jurisdiction" text,
  "jurisdictionModel" text,
  "tcString" text,
  "uiSource" text,
  "consentAction" text,
  "runtimePolicyDecisionId" text references c15t."runtimePolicyDecision"("id"),
  "runtimePolicySource" text,
  "tenantId" text,
  "choice" json,
  "vendorChoice" json,
  "experimentId" text,
  "experimentArm" text,
  "timeToDecisionMs" integer,
  "addtlConsent" text
);

create index "c15t_consent_tenantId_idx" on c15t."consent" ("tenantId");
`;
