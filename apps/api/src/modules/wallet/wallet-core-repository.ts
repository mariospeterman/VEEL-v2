import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { rotateApplicationSessionInTransaction } from "../auth/wallet-auth-repository.js";
import type { WalletRepository } from "./types.js";
import { WalletNotFoundError } from "./wallet-errors.js";
import { toWalletResource } from "./wallet-repository-mappers.js";
import type { WalletRow } from "./wallet-repository-rows.js";

export function createWalletCoreRepositoryMethods(
  sql: postgres.Sql
): Pick<
  WalletRepository,
  "listWalletsBySupabaseUserId" | "hasWalletBySupabaseUserId" | "findWalletForSupabaseUser" | "setPrimaryWallet"
> {
  return {
    async listWalletsBySupabaseUserId(supabaseUserId) {
      const rows = await sql<WalletRow[]>`
        select
          w.id,
          w.chain,
          w.address,
          w.provider,
          w.is_primary
        from users u
        join wallets w on w.user_id = u.id
        where u.supabase_user_id = ${supabaseUserId}
        order by w.is_primary desc, w.created_at asc
      `;

      return rows.map(toWalletResource);
    },
    async hasWalletBySupabaseUserId(supabaseUserId) {
      const rows = await sql<{ exists: boolean }[]>`
        select exists (
          select 1
          from users u
          join wallets w on w.user_id = u.id
          where u.supabase_user_id = ${supabaseUserId}
        ) as exists
      `;

      return rows[0]?.exists ?? false;
    },
    async findWalletForSupabaseUser(input) {
      const rows = await sql<WalletRow[]>`
        select
          w.id,
          w.chain,
          w.address,
          w.provider,
          w.is_primary
        from users u
        join wallets w on w.user_id = u.id
        where u.supabase_user_id = ${input.supabaseUserId}
          and w.id = ${input.walletId}
        limit 1
      `;

      const wallet = rows[0];

      return wallet ? toWalletResource(wallet) : null;
    },
    async setPrimaryWallet(input) {
      const rows = await sql.begin(async (tx) => {
        const walletRows = await tx<WalletRow[]>`
          select
            w.id,
            w.user_id,
            w.chain,
            w.address,
            w.provider,
            w.is_primary
          from users u
          join wallets w on w.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and w.id = ${input.walletId}
          limit 1
        `;

        const wallet = walletRows[0];

        if (!wallet?.user_id) {
          throw new WalletNotFoundError();
        }

        await tx`
          update wallets
          set is_primary = false,
              updated_at = now()
          where user_id = ${wallet.user_id}
            and id <> ${wallet.id}
            and is_primary = true
        `;

        const primaryRows = await tx<WalletRow[]>`
          update wallets
          set is_primary = true,
              updated_at = now()
          where id = ${wallet.id}
          returning id, chain, address, provider, is_primary
        `;

        await tx`
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            metadata
          )
          values (
            ${randomUUID()},
            ${wallet.user_id},
            'wallet',
            ${wallet.id},
            'wallet.primary_set',
            ${tx.json({
              chain: wallet.chain,
              provider: wallet.provider
            })}
          )
        `;

        const primaryWallet = primaryRows[0];
        if (!primaryWallet) throw new WalletNotFoundError();
        const session = await rotateApplicationSessionInTransaction(tx, {
          sessionToken: input.sessionToken,
          userId: wallet.user_id
        });
        return { wallet: primaryWallet, session };
      });

      if (!rows.wallet) {
        throw new WalletNotFoundError();
      }

      return { wallet: toWalletResource(rows.wallet), session: rows.session };
    }
  };
}
