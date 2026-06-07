import postgres from "postgres";

export type PostgresSql = postgres.Sql;
export type PostgresTransaction = postgres.TransactionSql;

export class PostgresConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "PostgresConfigurationError";
  }
}

export function createPostgresClient(databaseUrl: string): PostgresSql {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    prepare: false
  });
}

export function resolvePostgresClient(database: string | PostgresSql): {
  sql: PostgresSql;
  ownsClient: boolean;
} {
  if (typeof database === "string") {
    return {
      sql: createPostgresClient(database),
      ownsClient: true
    };
  }

  return {
    sql: database,
    ownsClient: false
  };
}

export async function withPostgresTransaction<T>(
  sql: PostgresSql,
  work: (transaction: PostgresTransaction) => Promise<T>
): Promise<T> {
  const result = await sql.begin((transaction) => work(transaction));
  return result as T;
}
