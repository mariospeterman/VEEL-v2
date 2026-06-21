import { requireAppAccess } from "@/supabase/route-guard";
import { getAdminPageData } from "./admin-data";
import { AdminPageHeader, AdminPrimaryColumn, AdminSecondaryColumn } from "./admin-page-sections";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAppAccess("/admin");
  const data = await getAdminPageData();

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          WeVid
        </a>
        <div className="rounded border border-(--line) px-3 py-1 text-xs font-medium text-(--muted)">
          Admin
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-6">
        <AdminPageHeader summary={data.summary} />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <AdminPrimaryColumn {...data} />
          <AdminSecondaryColumn {...data} />
        </section>
      </section>
    </main>
  );
}
