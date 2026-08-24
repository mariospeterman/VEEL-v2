import type { ReactNode } from "react";
import { getAdminCurrentStaff } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AdminShell } from "./admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAppAccess("/admin");
  const access = await getAdminCurrentStaff();

  if (!access.ok) {
    return (
      <main className="grid min-h-dvh place-items-center bg-(--background) px-6 text-(--foreground)">
        <section className="max-w-sm text-center">
          <p className="text-sm font-semibold text-(--accent-text)">WeVid Admin</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Staff access required</h1>
          <p className="mt-3 text-sm leading-6 text-(--muted)">{access.message}</p>
          <a className="mt-6 inline-flex min-h-11 items-center rounded-full bg-(--accent) px-5 text-sm font-semibold text-white" href="/app/home">Return to WeVid</a>
        </section>
      </main>
    );
  }

  return <AdminShell access={access.data}>{children}</AdminShell>;
}
