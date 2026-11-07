import type postgres from "postgres";

export const openReportStates = ["submitted", "queued", "reviewing", "escalated"] as const;

export async function countOpenReports(sql: postgres.Sql): Promise<number> {
  const rows = await sql<Array<{ open_reports: string | number }>>`
    select count(*) as open_reports
    from reports
    where state = any(${[...openReportStates]}::text[])
  `;

  return Number(rows[0]?.open_reports ?? 0);
}
