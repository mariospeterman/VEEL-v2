#!/usr/bin/env node
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { assertSafeStagingTarget } from "./staging-config.mjs";

const mode = process.argv[2];
if (!new Set(["seed", "cleanup"]).has(mode)) throw new Error("Use seed or cleanup");
assertSafeStagingTarget();

const namespace = process.env.STAGING_FIXTURE_NAMESPACE ?? "";
if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(namespace)) throw new Error("STAGING_FIXTURE_NAMESPACE must be a safe 3-64 character namespace");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  if (mode === "seed") await seed();
  else await cleanup();
} finally {
  await sql.end();
}

async function seed() {
  const requested = parseUsers(process.env.STAGING_FIXTURE_USERS_JSON);
  if (!requested.length) {
    console.log("BLOCKED staging_seed STAGING_FIXTURE_USERS_JSON must reference existing onboarded WeVid users");
    process.exitCode = 2;
    return;
  }

  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${`wevid-staging:${namespace}`}))`;
    for (const item of requested) {
      const users = await transaction`
        select id from users where id = ${item.userId}::uuid and state = 'active'
      `;
      if (!users[0]) throw new Error(`Existing active WeVid user not found for ${item.label}`);

      const membershipId = randomUUID();
      const inserted = await transaction`
        insert into staff_memberships (id, user_id, role, state, granted_by_user_id)
        values (${membershipId}::uuid, ${item.userId}::uuid, ${item.role}::staff_role, 'active', ${requested[0].userId}::uuid)
        on conflict (user_id, role) do nothing
        returning id
      `;
      if (inserted[0]) {
        await transaction`
          insert into staging_fixture_resources (namespace, resource_type, resource_id)
          values (${namespace}, 'staff_membership', ${inserted[0].id}::uuid)
          on conflict do nothing
        `;
      }
    }
    await transaction`
      insert into audit_events (id, actor_user_id, subject_type, action, metadata)
      values (${randomUUID()}::uuid, ${requested[0].userId}::uuid, 'staging_fixture_namespace',
        'staging_fixture_staff_bootstrapped', jsonb_build_object('namespace', ${namespace}, 'count', ${requested.length}))
    `;
  });
  console.log(`READY staging_seed namespace=${namespace} existing_users=${requested.length}`);
  console.log("Controlled content/provider fixtures are created through staging:acceptance after real identity onboarding.");
}

async function cleanup() {
  if (process.env.STAGING_CLEANUP_ACK !== `DELETE_FIXTURES:${namespace}`) {
    console.log(`BLOCKED staging_cleanup acknowledgement_required=DELETE_FIXTURES:${namespace}`);
    process.exitCode = 2;
    return;
  }
  const deleted = await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${`wevid-staging:${namespace}`}))`;
    const rows = await transaction`
      select resource_id from staging_fixture_resources
      where namespace = ${namespace} and resource_type = 'staff_membership'
      for update
    `;
    if (rows.length) {
      await transaction`delete from staff_memberships where id = any(${rows.map((row) => row.resource_id)}::uuid[])`;
    }
    await transaction`delete from staging_fixture_resources where namespace = ${namespace}`;
    return rows.length;
  });
  console.log(`READY staging_cleanup namespace=${namespace} removed=${deleted}`);
}

function parseUsers(value) {
  if (!value) return [];
  const input = JSON.parse(value);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("STAGING_FIXTURE_USERS_JSON must be an object");
  const roles = {
    platform_owner: "owner",
    trust_safety: "trust_safety",
    finance: "finance",
    support: "support",
    operations: "ops",
    compliance: "compliance",
    readonly_auditor: "readonly_auditor"
  };
  return Object.entries(roles).flatMap(([label, role]) => {
    const userId = input[label];
    if (userId === undefined) return [];
    if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error(`${label} must be an existing WeVid user UUID`);
    return [{ label, role, userId }];
  });
}
