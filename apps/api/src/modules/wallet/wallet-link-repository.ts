import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { rotateApplicationSessionInTransaction } from "../auth/wallet-auth-repository.js";
import type { WalletRepository } from "./types.js";
import {
  WalletLinkChallengeNotFoundError,
  WalletLinkConflictError
} from "./wallet-errors.js";
import {
  isUniqueViolation,
  toStoredWalletLinkChallenge,
  toWalletLinkChallenge,
  toWalletResource
} from "./wallet-repository-mappers.js";
import type { WalletChallengeRow, WalletRow } from "./wallet-repository-rows.js";

export function createWalletLinkRepositoryMethods(
  sql: postgres.Sql
): Pick<
  WalletRepository,
  "createLinkChallenge" | "consumeVerifiedExternalWalletLink" | "findLinkChallenge"
> {
  return {
    async createLinkChallenge(input) {
      const rows = await sql<WalletChallengeRow[]>`
        with target_user as (
          select id
          from users
          where id = ${input.userId}
          limit 1
        )
        insert into wallet_link_challenges (
          id,
          user_id,
          chain,
          provider,
          address,
          message,
          nonce_hash,
          expires_at
        )
        select
          ${randomUUID()},
          id,
          ${input.chain},
          ${input.provider},
          ${input.address},
          ${input.message},
          ${input.nonceHash},
          ${input.expiresAt}
        from target_user
        returning id, user_id, chain, provider, address, message, expires_at, consumed_at
      `;

      const row = rows[0];

      if (!row) {
        throw new WalletLinkChallengeNotFoundError();
      }

      return toWalletLinkChallenge(row);
    },
    async findLinkChallenge(input) {
      const rows = await sql<WalletChallengeRow[]>`
        select
          wlc.id,
          wlc.user_id,
          wlc.chain,
          wlc.provider,
          wlc.address,
          wlc.message,
          wlc.expires_at,
          wlc.consumed_at
        from wallet_link_challenges wlc
        where wlc.id = ${input.challengeId}
          and wlc.user_id = ${input.userId}
        limit 1
      `;

      const row = rows[0];

      return row ? toStoredWalletLinkChallenge(row) : null;
    },
    async consumeVerifiedExternalWalletLink(input) {
      try {
        const result = await sql.begin(async (tx) => {
          const challengeRows = await tx<WalletChallengeRow[]>`
            update wallet_link_challenges
            set consumed_at = now()
          where id = ${input.challengeId}
            and user_id = ${input.userId}
            and consumed_at is null
            and expires_at > now()
            returning id, user_id, chain, provider, address, message, expires_at, consumed_at
          `;

          const challenge = challengeRows[0];

          if (!challenge) {
            throw new WalletLinkChallengeNotFoundError();
          }

          const existingWalletRows = await tx<WalletRow[]>`
            select
              id,
              user_id,
              chain,
              address,
              provider,
              is_primary
            from wallets
            where chain = ${challenge.chain}
              and address = ${challenge.address}
            limit 1
          `;

          const existingWallet = existingWalletRows[0];

          if (existingWallet) {
            if (existingWallet.user_id !== challenge.user_id) {
              throw new WalletLinkConflictError();
            }

            const session = await rotateApplicationSessionInTransaction(tx, {
              sessionToken: input.sessionToken,
              userId: challenge.user_id
            });
            return { wallet: existingWallet, session };
          }

          const hasWalletRows = await tx<{ exists: boolean }[]>`
            select exists (
              select 1
              from wallets
              where user_id = ${challenge.user_id}
            ) as exists
          `;
          const shouldSetPrimary = !(hasWalletRows[0]?.exists ?? false);

          const walletRows = await tx<WalletRow[]>`
            insert into wallets (
              id,
              user_id,
              provider,
              address,
              chain,
              is_primary
            )
            values (
              ${randomUUID()},
              ${challenge.user_id},
              ${challenge.provider},
              ${challenge.address},
              ${challenge.chain},
              ${shouldSetPrimary}
            )
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
              ${challenge.user_id},
              'wallet',
              ${walletRows[0]?.id ?? null},
              'wallet.linked',
              ${tx.json({
                chain: challenge.chain,
                provider: challenge.provider
              })}
            )
          `;

          const wallet = walletRows[0];
          if (!wallet) throw new WalletLinkChallengeNotFoundError();
          const session = await rotateApplicationSessionInTransaction(tx, {
            sessionToken: input.sessionToken,
            userId: challenge.user_id
          });
          return { wallet, session };
        });

        if (!result.wallet) {
          throw new WalletLinkChallengeNotFoundError();
        }

        return { wallet: toWalletResource(result.wallet), session: result.session };
      } catch (error) {
        if (error instanceof WalletLinkChallengeNotFoundError) {
          throw error;
        }

        if (isUniqueViolation(error)) {
          throw new WalletLinkConflictError();
        }

        throw error;
      }
    }
  };
}
