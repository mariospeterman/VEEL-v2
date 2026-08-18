import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { WalletRepository } from "./types.js";
import { WalletNotFoundError } from "./wallet-errors.js";
import {
  isUniqueViolation,
  toOnrampSessionResource
} from "./wallet-repository-mappers.js";
import type { OnrampSessionRow } from "./wallet-repository-rows.js";

export function createWalletOnrampRepositoryMethods(
  sql: postgres.Sql
): Pick<WalletRepository, "findOnrampSessionByIdempotencyKey" | "recordOnrampSession"> {
  return {
    async findOnrampSessionByIdempotencyKey(input) {
      const rows = await sql<OnrampSessionRow[]>`
        select
          wos.id,
          wos.provider,
          wos.launch_url,
          wos.wallet_id,
          wos.wallet_address,
          wos.state,
          wos.created_at,
          wos.expires_at
        from wallet_onramp_sessions wos
        where wos.user_id = ${input.userId}
          and wos.idempotency_key = ${input.idempotencyKey}
        limit 1
      `;

      const session = rows[0];

      return session ? toOnrampSessionResource(session) : null;
    },
    async recordOnrampSession(input) {
      try {
        const rows = await sql<OnrampSessionRow[]>`
          with target_user as (
            select id
            from users
            where id = ${input.userId}
            limit 1
          ),
          target_wallet as (
            select w.id, w.user_id
            from wallets w
            join target_user tu on tu.id = w.user_id
            where w.id = ${input.walletId}
            limit 1
          )
          insert into wallet_onramp_sessions (
            id,
            user_id,
            wallet_id,
            idempotency_key,
            provider,
            provider_session_reference_hash,
            wallet_address,
            chain,
            purchase_currency,
            launch_url,
            return_url,
            expires_at
          )
          select
            ${randomUUID()},
            user_id,
            id,
            ${input.idempotencyKey},
            ${input.provider},
            ${input.providerSessionReferenceHash},
            ${input.walletAddress},
            ${input.chain},
            ${input.purchaseCurrency},
            ${input.launchUrl},
            ${input.returnUrl},
            ${input.expiresAt}
          from target_wallet
          returning id, provider, launch_url, wallet_id, wallet_address, state, created_at, expires_at
        `;

        const session = rows[0];

        if (!session) {
          throw new WalletNotFoundError();
        }

        return toOnrampSessionResource(session);
      } catch (error) {
        if (isUniqueViolation(error)) {
          const existingRows = await sql<OnrampSessionRow[]>`
            select
              wos.id,
              wos.provider,
              wos.launch_url,
              wos.wallet_id,
              wos.wallet_address,
              wos.state,
              wos.created_at,
              wos.expires_at
            from wallet_onramp_sessions wos
            where wos.user_id = ${input.userId}
              and wos.idempotency_key = ${input.idempotencyKey}
            limit 1
          `;
          const existing = existingRows[0];

          if (existing) {
            return toOnrampSessionResource(existing);
          }
        }

        throw error;
      }
    }
  };
}
