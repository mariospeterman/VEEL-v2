import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_ROLLBACK_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;
const migrations = new URL("../migrations/", import.meta.url);

describeIntegration("canonical rollback SQL against migrated Postgres", () => {
  let sql: postgres.Sql | undefined;

  beforeAll(() => {
    const databaseUrl = process.env.ROLLBACK_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) throw new Error("ROLLBACK_INTEGRATION_DATABASE_URL is required");
    const host = new URL(databaseUrl).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      throw new Error("Rollback integration tests require an isolated loopback database");
    }
    sql = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("removes only the guarded Realtime publication members and reapplies them", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const down = migration("0039_realtime_projection_publication.down.sql");
    const up = migration("0039_realtime_projection_publication.sql");

    const publication = await sql<{ puballtables: boolean }[]>`
      select puballtables from pg_publication where pubname = 'supabase_realtime'
    `;
    expect(publication).toEqual([{ puballtables: false }]);

    await sql.unsafe(down);
    expect(await realtimeProjectionCount(sql)).toBe(0);
    await sql.unsafe(down);
    expect(await realtimeProjectionCount(sql)).toBe(0);

    await sql.unsafe(up);
    expect(await realtimeProjectionCount(sql)).toBe(3);
  });

  it("upgrades populated legacy feed preferences and safely rolls them down and forward again", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const down = migration("0130_media_core_scope_transition.down.sql");
    const up = migration("0130_media_core_scope_transition.sql");
    const recommendedUserId = randomUUID();
    const followingUserId = randomUUID();
    const publishedImageId = randomUUID();
    const publishedVideoId = randomUUID();
    const draftImageId = randomUUID();
    const draftVideoId = randomUUID();
    const scheduledTextId = randomUUID();
    const scheduledPollId = randomUUID();
    const entitlementId = randomUUID();

    await sql.begin(async (transaction) => {
      await transaction.unsafe(down);
      await transaction`
        insert into users (id, supabase_user_id, state) values
          (${recommendedUserId}, ${recommendedUserId}, 'active'),
          (${followingUserId}, ${followingUserId}, 'active')
      `;
      await transaction`
        insert into viewer_feed_preferences (user_id, default_feed_mode) values
          (${recommendedUserId}, 'recommended'),
          (${followingUserId}, 'following')
      `;
      await transaction`set local session_replication_role = replica`;
      await transaction`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, moderation_state, created_at, publish_requested_at,
          published_at, scheduled_for
        ) values
          (${publishedImageId}, ${recommendedUserId}, 'image', 'ready', 'published',
            'public', 'approved', '2026-10-01T10:00:00.123456Z',
            '2026-10-02T11:00:00.654321Z', null, null),
          (${publishedVideoId}, ${recommendedUserId}, 'vod', 'ready', 'published',
            'public', 'approved', '2026-10-03T12:00:00.123456Z',
            null, null, null),
          (${draftImageId}, ${recommendedUserId}, 'image', 'draft', 'draft',
            'private', 'pending', now(), null, null, null),
          (${draftVideoId}, ${recommendedUserId}, 'vod', 'draft', 'draft',
            'private', 'pending', now(), null, null, null),
          (${scheduledTextId}, ${recommendedUserId}, 'text', 'ready', 'scheduled',
            'public', 'approved', now(), null, null, now() + interval '1 day'),
          (${scheduledPollId}, ${recommendedUserId}, 'poll', 'ready', 'scheduled',
            'public', 'approved', now(), null, null, now() + interval '2 days')
      `;
      await transaction`
        insert into content_publication_jobs (
          content_item_id, creator_user_id, scheduled_for, state, next_attempt_at
        ) values
          (${scheduledTextId}, ${recommendedUserId}, now() + interval '1 day', 'queued', now()),
          (${scheduledPollId}, ${recommendedUserId}, now() + interval '2 days', 'retry', now())
      `;
      await transaction`
        insert into entitlements (
          id, user_id, target_type, target_id, product_type, state
        ) values (
          ${entitlementId}, ${followingUserId}, 'content', ${publishedImageId},
          'content_unlock', 'active'
        )
      `;
      await transaction`set local session_replication_role = origin`;

      await transaction.unsafe(up);
      expect(await feedPreferenceModes(transaction, [recommendedUserId, followingUserId])).toEqual([
        { default_feed_mode: "latest", user_id: recommendedUserId },
        { default_feed_mode: "following", user_id: followingUserId }
      ]);
      await expectFeedPreferenceConstraint(transaction, ["latest", "following"]);
      const contentRows = await transaction<Array<{
        id: string;
        publish_state: string;
        published_at: Date | null;
      }>>`
        select id, publish_state, published_at
        from content_items
        where id = any(${[
          publishedImageId, publishedVideoId, draftImageId,
          draftVideoId, scheduledTextId, scheduledPollId
        ]}::uuid[])
        order by id
      `;
      expect(contentRows).toHaveLength(6);
      const contentById = new Map(contentRows.map((row) => [row.id, row]));
      expect(contentById.get(publishedImageId)?.published_at?.toISOString())
        .toBe("2026-10-02T11:00:00.654Z");
      expect(contentById.get(publishedVideoId)?.published_at?.toISOString())
        .toBe("2026-10-03T12:00:00.123Z");
      expect(contentById.get(draftImageId)?.publish_state).toBe("draft");
      expect(contentById.get(draftVideoId)?.publish_state).toBe("draft");
      expect(contentById.get(scheduledTextId)?.publish_state).toBe("unpublished");
      expect(contentById.get(scheduledPollId)?.publish_state).toBe("unpublished");
      const publicationJobs = await transaction<Array<{
        content_item_id: string;
        last_error_code: string | null;
        state: string;
      }>>`
        select content_item_id, last_error_code, state
        from content_publication_jobs
        where content_item_id in (${scheduledTextId}, ${scheduledPollId})
        order by content_item_id
      `;
      expect(publicationJobs).toHaveLength(2);
      expect(publicationJobs.every((job) =>
        job.state === "cancelled" && job.last_error_code === "content_format_retired"
      )).toBe(true);
      const rights = await transaction<Array<{ state: string; target_id: string }>>`
        select state, target_id from entitlements where id = ${entitlementId}
      `;
      expect(rights).toEqual([{ state: "active", target_id: publishedImageId }]);

      await transaction.unsafe(down);
      expect(await feedPreferenceModes(transaction, [recommendedUserId, followingUserId])).toEqual([
        { default_feed_mode: "recommended", user_id: recommendedUserId },
        { default_feed_mode: "following", user_id: followingUserId }
      ]);
      await expectFeedPreferenceConstraint(transaction, ["recommended", "following"]);

      await transaction.unsafe(up);
      expect(await feedPreferenceModes(transaction, [recommendedUserId, followingUserId])).toEqual([
        { default_feed_mode: "latest", user_id: recommendedUserId },
        { default_feed_mode: "following", user_id: followingUserId }
      ]);
      await expectFeedPreferenceConstraint(transaction, ["latest", "following"]);

      await transaction`delete from entitlements where id = ${entitlementId}`;
      await transaction`
        delete from content_items where id = any(${[
          publishedImageId, publishedVideoId, draftImageId,
          draftVideoId, scheduledTextId, scheduledPollId
        ]}::uuid[])
      `;
      await transaction`delete from viewer_feed_preferences where user_id in (${recommendedUserId}, ${followingUserId})`;
      await transaction`delete from users where id in (${recommendedUserId}, ${followingUserId})`;
    });
  });

  it("refuses the retired recommended mode after the 0130 transition", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const userId = randomUUID();

    await expect(
      sql.begin(async (transaction) => {
        await transaction`
          insert into users (id, supabase_user_id, state)
          values (${userId}, ${userId}, 'active')
        `;
        await transaction`
          insert into viewer_feed_preferences (user_id, default_feed_mode)
          values (${userId}, 'recommended')
        `;
      })
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("preserves historical recurring receipts and enforces 0136 consent and signed-state invariants", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const up = migration("0136_recurring_payment_recovery_invariants.sql");
    const down = migration("0136_recurring_payment_recovery_invariants.down.sql");
    const userId = randomUUID();
    const receiptId = randomUUID();
    const planId = `rollback-plan-${randomUUID()}`;
    const subscriptionId = randomUUID();
    const authorizationIntentId = randomUUID();

    await inRolledBackTransaction(sql, async (transaction) => {
      if (await columnExists(transaction, "subscription_plans", "price_minor")) {
        await transaction.unsafe(down);
      }
      const historicalConstraint = await constraintDefinition(
        transaction,
        "subscription_action_receipts",
        "subscription_action_receipts_action_check"
      );

      await transaction`
        insert into users (id, supabase_user_id, state)
        values (${userId}, ${userId}, 'active')
      `;
      await transaction`
        insert into subscription_action_receipts (
          id, actor_user_id, action, idempotency_key, request_hash, response_body
        ) values (
          ${receiptId}, ${userId}, 'revoke_submission', 'historical-revoke',
          'historical-revoke-hash', ${transaction.json({ state: "submitted" })}
        )
      `;

      await transaction.unsafe(up);
      expect(await transaction<{ action: string }[]>`
        select action from subscription_action_receipts where id = ${receiptId}
      `).toEqual([{ action: "revoke_submission" }]);

      await transaction`
        insert into subscription_plans (
          id, scope, label, amount_minor, currency, period_days, billing_mode,
          provider_state, token_mint, token_program, state, provider, program_id,
          amount_atomic, period_seconds, creator_amount_atomic,
          platform_fee_amount_atomic, allocation_amount_atomic
        ) values (
          ${planId}, 'platform', 'Rollback invariant plan', 100, 'USDC', 30,
          'delegated_solana_subscription', 'staging_required', 'test-usdc-mint',
          'spl_token', 'disabled', 'official_solana_subscription_program',
          'test-subscription-program', 1000000, 2592000, 0, 1000000, 0
        )
      `;
      await transaction`
        insert into subscriptions (
          id, subscriber_user_id, scope, plan_id, state, renewal_mode,
          token_mint, amount_atomic, period_seconds
        ) values (
          ${subscriptionId}, ${userId}, 'platform', ${planId},
          'authorization_pending', 'delegated_solana_subscription',
          'test-usdc-mint', 1000000, 2592000
        )
      `;
      await transaction`
        insert into subscription_authorization_intents (
          id, subscription_id, idempotency_key, request_hash, state,
          authorization_mode, setup_reference, expires_at
        ) values (
          ${authorizationIntentId}, ${subscriptionId}, 'acceptance-test',
          'acceptance-test-hash', 'created', 'delegated_solana_subscription',
          ${`setup-${authorizationIntentId}`}, now() + interval '1 hour'
        )
      `;

      await expect(transaction.savepoint(async (savepoint) => {
        await insertBillingAcceptance(savepoint, {
          amountAtomic: 999999,
          authorizationIntentId,
          immutableHash: `invalid-amount-${authorizationIntentId}`,
          periodSeconds: 2592000,
          planId,
          subscriptionId,
          userId
        });
      })).rejects.toMatchObject({ code: "23514" });

      await inRolledBackSavepoint(transaction, async (savepoint) => {
        await insertBillingAcceptance(savepoint, {
          amountAtomic: 1000000,
          authorizationIntentId,
          immutableHash: `valid-control-${authorizationIntentId}`,
          periodSeconds: 2592000,
          planId,
          subscriptionId,
          userId
        });
        expect(await savepoint<{ count: number }[]>`
          select count(*)::integer as count
          from subscription_billing_acceptances
          where subscription_id = ${subscriptionId}
        `).toEqual([{ count: 1 }]);
      });

      await expect(transaction.savepoint(async (savepoint) => {
        await insertBillingAcceptance(savepoint, {
          amountAtomic: 1000000,
          authorizationIntentId,
          immutableHash: `invalid-period-${authorizationIntentId}`,
          periodSeconds: 1,
          planId,
          subscriptionId,
          userId
        });
      })).rejects.toMatchObject({ code: "23514" });

      await expect(transaction.savepoint(async (savepoint) => {
        await savepoint`
          insert into subscription_collections (
            id, subscription_id, period_starts_at, period_ends_at,
            amount_minor, amount_atomic, currency, state, due_at,
            broadcast_started_at, broadcast_lease_token, broadcast_signature,
            broadcast_transaction_base64, broadcast_blockhash,
            broadcast_last_valid_block_height, broadcast_prepared_at
          ) values (
            ${randomUUID()}, ${subscriptionId}, now(), now() + interval '30 days',
            100, 1000000, 'USDC', 'failed', now(), now(), ${randomUUID()},
            ${`signed-terminal-${randomUUID()}`}, 'dGVzdA==', 'test-blockhash',
            123456, now()
          )
        `;
      })).rejects.toMatchObject({
        code: "23514",
        constraint_name: "subscription_collections_signed_state_check"
      });

      await transaction.unsafe(down);
      expect(await constraintDefinition(
        transaction,
        "subscription_action_receipts",
        "subscription_action_receipts_action_check"
      )).toBe(historicalConstraint);
      expect(await transaction<{ action: string }[]>`
        select action from subscription_action_receipts where id = ${receiptId}
      `).toEqual([{ action: "revoke_submission" }]);
    });
  });

  it("refuses 0136 rollback atomically once durable recurring idempotency evidence exists", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const up = migration("0136_recurring_payment_recovery_invariants.sql");
    const down = migration("0136_recurring_payment_recovery_invariants.down.sql");
    const userId = randomUUID();
    const receiptId = randomUUID();

    await inRolledBackTransaction(sql, async (transaction) => {
      if (!await columnExists(transaction, "subscription_plans", "price_minor")) {
        await transaction.unsafe(up);
      }
      await transaction`
        insert into users (id, supabase_user_id, state)
        values (${userId}, ${userId}, 'active')
      `;
      await transaction`
        insert into subscription_action_receipts (
          id, actor_user_id, action, idempotency_key, request_hash, response_body
        ) values (
          ${receiptId}, ${userId}, 'authorization_intent_create',
          'durable-authorization-create', 'durable-authorization-create-hash',
          ${transaction.json({ state: "created" })}
        )
      `;

      await expect(transaction.savepoint(async (savepoint) => {
        await savepoint.unsafe(down);
      })).rejects.toMatchObject({ code: "55000" });

      expect(await columnExists(transaction, "subscription_plans", "price_minor")).toBe(true);
      expect(await relationExists(transaction, "subscription_finance_outbox_events")).toBe(true);
      expect(await transaction<{ action: string }[]>`
        select action from subscription_action_receipts where id = ${receiptId}
      `).toEqual([{ action: "authorization_intent_create" }]);
      expect(await constraintDefinition(
        transaction,
        "subscription_action_receipts",
        "subscription_action_receipts_action_check"
      )).toContain("authorization_intent_create");
    });
  });

  it("rolls Moment schema down and reapplies it only while no Moment evidence exists", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const latestDown = migration("0130_media_core_scope_transition.down.sql");
    const latestUp = migration("0130_media_core_scope_transition.sql");
    const down = migration("0117_moments_and_scheduled_publication.down.sql");
    const up = migration("0117_moments_and_scheduled_publication.sql");
    const moments = await sql<{ count: number }[]>`
      select count(*)::integer as count from content_items where distribution_mode = 'moment'
    `;
    expect(moments[0]?.count).toBe(0);

    await sql.begin(async (transaction) => {
      await transaction.unsafe(latestDown);
      await transaction.unsafe(down);
    });
    expect(await columnExists(sql, "content_items", "distribution_mode")).toBe(false);
    expect(await relationExists(sql, "content_publication_jobs")).toBe(false);

    await sql.begin(async (transaction) => {
      await transaction.unsafe(up);
      await transaction.unsafe(latestUp);
    });
    await expectMomentSchemaPresent(sql);
  });

  it("aborts a populated Moment rollback without changing rows or expiry authority", async () => {
    if (!sql) throw new Error("Rollback test database was not initialized");
    const down = migration("0117_moments_and_scheduled_publication.down.sql");
    const userId = randomUUID();
    const contentId = randomUUID();

    await sql`insert into users (id, supabase_user_id, state) values (${userId}, ${userId}, 'active')`;
    await sql`
      insert into content_items (
        id, creator_user_id, media_type, state, publish_state, caption,
        visibility, nsfw_label, moderation_state, distribution_mode, expires_at
      ) values (
        ${contentId}, ${userId}, 'image', 'draft', 'draft', 'Rollback privacy fixture',
        'private', 'none', 'pending', 'moment', now() + interval '1 hour'
      )
    `;

    try {
      let rollbackError: unknown;
      try {
        await sql.begin(async (transaction) => {
          await transaction.unsafe(down);
        });
      } catch (error) {
        rollbackError = error;
      }

      expect(rollbackError).toMatchObject({ code: "55000" });
      const retained = await sql<{ distribution_mode: string; expires_at: Date | null }[]>`
        select distribution_mode, expires_at from content_items where id = ${contentId}
      `;
      expect(retained[0]?.distribution_mode).toBe("moment");
      expect(retained[0]?.expires_at).toBeInstanceOf(Date);
      await expectMomentSchemaPresent(sql);
    } finally {
      await sql`delete from content_items where id = ${contentId}`;
      await sql`delete from users where id = ${userId}`;
    }
  });
});

function migration(fileName: string): string {
  return readFileSync(new URL(fileName, migrations), "utf8");
}

async function realtimeProjectionCount(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('conversation_members', 'messages', 'notifications')
  `;
  return rows[0]?.count ?? -1;
}

async function columnExists(
  sql: postgres.Sql | postgres.TransactionSql,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name = ${column}
    ) as present
  `;
  return rows[0]?.present ?? false;
}

async function relationExists(
  sql: postgres.Sql | postgres.TransactionSql,
  relation: string
): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    select to_regclass(${'public.' + relation}) is not null as present
  `;
  return rows[0]?.present ?? false;
}

async function constraintDefinition(
  sql: postgres.Sql | postgres.TransactionSql,
  table: string,
  constraint: string
): Promise<string> {
  const rows = await sql<{ definition: string }[]>`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = ${`public.${table}`}::regclass
      and conname = ${constraint}
  `;
  expect(rows).toHaveLength(1);
  return rows[0]?.definition ?? "";
}

async function inRolledBackTransaction(
  sql: postgres.Sql,
  callback: (transaction: postgres.TransactionSql) => Promise<void>
): Promise<void> {
  const rollback = Symbol("rollback integration fixture");
  try {
    await sql.begin(async (transaction) => {
      await callback(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function inRolledBackSavepoint(
  sql: postgres.TransactionSql,
  callback: (savepoint: postgres.TransactionSql) => Promise<void>
): Promise<void> {
  const rollback = Symbol("rollback integration savepoint fixture");
  try {
    await sql.savepoint(async (savepoint) => {
      await callback(savepoint);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function insertBillingAcceptance(
  sql: postgres.TransactionSql,
  input: {
    amountAtomic: number;
    authorizationIntentId: string;
    immutableHash: string;
    periodSeconds: number;
    planId: string;
    subscriptionId: string;
    userId: string;
  }
): Promise<void> {
  await sql`
    insert into subscription_billing_acceptances (
      subscription_id, authorization_intent_id, accepted_by_user_id, plan_id,
      scope, terms_version, withdrawal_waiver_version,
      immediate_access_acknowledged, consent_request_hash, amount_minor,
      amount_atomic, asset_decimals, currency, solana_network, token_mint,
      token_program, provider, program_id, period_days, period_seconds,
      creator_amount_atomic, platform_amount_atomic, allocation_amount_atomic,
      platform_receiver_wallet, collector_address, delegation_nonce, immutable_hash
    ) values (
      ${input.subscriptionId}, ${input.authorizationIntentId}, ${input.userId},
      ${input.planId}, 'platform', 'terms-v1', 'withdrawal-v1', true,
      ${`consent-${input.immutableHash}`}, 100, ${input.amountAtomic}, 6,
      'USDC', 'devnet', 'test-usdc-mint', 'spl_token',
      'official_solana_subscription_program', 'test-subscription-program',
      30, ${input.periodSeconds}, 0, ${input.amountAtomic}, 0,
      'test-platform-receiver', 'test-collector', 1, ${input.immutableHash}
    )
  `;
}

async function feedPreferenceModes(
  sql: postgres.Sql | postgres.TransactionSql,
  userIds: string[]
): Promise<Array<{ default_feed_mode: string; user_id: string }>> {
  return sql<Array<{ default_feed_mode: string; user_id: string }>>`
    select user_id, default_feed_mode
    from viewer_feed_preferences
    where user_id = any(${userIds}::uuid[])
    order by array_position(${userIds}::uuid[], user_id)
  `;
}

async function expectFeedPreferenceConstraint(
  sql: postgres.Sql | postgres.TransactionSql,
  allowedModes: string[]
): Promise<void> {
  const rows = await sql<Array<{ definition: string; validated: boolean }>>`
    select
      pg_get_constraintdef(oid) as definition,
      convalidated as validated
    from pg_constraint
    where conrelid = 'public.viewer_feed_preferences'::regclass
      and conname = 'viewer_feed_preferences_default_feed_mode_check'
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.validated).toBe(true);
  for (const mode of allowedModes) expect(rows[0]?.definition).toContain(`'${mode}'`);

  const retiredMode = allowedModes.includes("latest") ? "recommended" : "latest";
  expect(rows[0]?.definition).not.toContain(`'${retiredMode}'`);

  const transition = await sql<Array<{ present: boolean }>>`
    select exists (
      select 1
      from pg_constraint
      where conrelid = 'public.viewer_feed_preferences'::regclass
        and conname = 'viewer_feed_preferences_default_feed_mode_transition_check'
    ) as present
  `;
  expect(transition).toEqual([{ present: false }]);
}

async function expectMomentSchemaPresent(sql: postgres.Sql): Promise<void> {
  expect(await columnExists(sql, "content_items", "distribution_mode")).toBe(true);
  expect(await columnExists(sql, "content_items", "expires_at")).toBe(true);
  expect(await columnExists(sql, "content_items", "scheduled_for")).toBe(true);
  expect(await relationExists(sql, "content_publication_jobs")).toBe(true);

  const rows = await sql<{ function_present: boolean; trigger_present: boolean }[]>`
    select
      to_regprocedure('private.eligible_content(uuid,text)') is not null as function_present,
      exists (
        select 1 from pg_trigger
        where tgname = 'content_items_sync_publication_job' and not tgisinternal
      ) as trigger_present
  `;
  expect(rows[0]).toEqual({ function_present: true, trigger_present: true });
}
