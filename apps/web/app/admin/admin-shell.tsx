import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Activity,
  Bot,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  FileSearch,
  Flag,
  Gauge,
  LifeBuoy,
  Radio,
  Settings,
  ShieldCheck,
  Users,
  Video
} from "lucide-react";
import type { AdminCurrentStaff, AdminPermission } from "@/api-client";

const navigation: Array<{
  href: Route | ReturnType<typeof adminSection>;
  label: string;
  icon: typeof Gauge;
  anyOf: AdminPermission[];
}> = [
  { href: "/admin", label: "Overview", icon: Gauge, anyOf: ["admin.overview.read"] },
  { href: adminSection("users"), label: "Users", icon: Users, anyOf: ["admin.users.read"] },
  { href: adminSection("content"), label: "Content", icon: Video, anyOf: ["admin.content.read"] },
  { href: adminSection("safety"), label: "Safety", icon: ShieldCheck, anyOf: ["admin.reports.read"] },
  { href: adminSection("payments"), label: "Payments", icon: CircleDollarSign, anyOf: ["admin.payments.read"] },
  { href: adminSection("subscriptions"), label: "Subscriptions", icon: Activity, anyOf: ["admin.subscriptions.read"] },
  { href: adminSection("live"), label: "Live", icon: Radio, anyOf: ["admin.live.read"] },
  { href: adminSection("events"), label: "Events", icon: ClipboardCheck, anyOf: ["admin.events.read"] },
  { href: adminSection("providers"), label: "Providers", icon: LifeBuoy, anyOf: ["admin.providers.read", "admin.queues.read"] },
  { href: adminSection("organizations"), label: "Organizations", icon: Building2, anyOf: ["admin.organizations.read"] },
  { href: adminSection("analytics"), label: "Analytics", icon: Activity, anyOf: ["admin.analytics.read"] },
  { href: adminSection("privacy"), label: "Privacy", icon: FileSearch, anyOf: ["admin.privacy.read"] },
  { href: adminSection("compliance"), label: "Compliance", icon: ClipboardCheck, anyOf: ["admin.compliance.read"] },
  { href: adminSection("ai"), label: "AI", icon: Bot, anyOf: ["admin.ai.read"] },
  { href: adminSection("audit"), label: "Audit", icon: FileSearch, anyOf: ["admin.audit.read"] },
  { href: "/admin/staff", label: "Staff", icon: Users, anyOf: ["admin.staff.read"] },
  { href: adminSection("settings"), label: "Settings", icon: Settings, anyOf: ["admin.feature_flags.read"] }
];

function adminSection(section: string) {
  return { pathname: "/admin/[section]" as const, query: { section } };
}

export function AdminShell({ access, children }: { access: AdminCurrentStaff; children: ReactNode }) {
  const permissions = new Set(access.permissions);
  const links = navigation.filter((item) => item.anyOf.some((permission) => permissions.has(permission)));

  return (
    <main className="min-h-dvh bg-(--background) text-(--foreground)">
      <header className="sticky top-0 z-30 border-b border-(--line) bg-(--background)/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link className="text-xl font-black tracking-[-0.04em]" href="/app/home">WeVid</Link>
            <span className="rounded-full bg-(--panel) px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-(--muted)">Admin</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-(--muted)">
            <Flag aria-hidden="true" className="size-4" />
            <span>{access.roles.join(" · ")}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="border-b border-(--line) md:min-h-[calc(100dvh-4rem)] md:border-r md:border-b-0">
          <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto p-3 md:sticky md:top-16 md:grid md:overflow-visible md:p-4">
            {links.map(({ href, icon: Icon, label }) => (
              <Link
                className="flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
                href={href}
                key={label}
              >
                <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </div>
    </main>
  );
}
