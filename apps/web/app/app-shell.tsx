"use client";

import { appShellNavItems, appShellTopActionItems } from "@veel/ui";
import {
  Bell,
  Clapperboard,
  Compass,
  Home,
  MessageCircle,
  PlusSquare,
  Search,
  Settings,
  UserRound,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <main className="app-root">
      <div className="app-shell">
        <aside className="app-rail" aria-label="Primary">
          <Link className="brand-lockup" href="/app/home" aria-label="WeVid app home">
            <img alt="" className="theme-logo-image-dark" src="/Logo-Light-Transparent.png" />
            <img alt="" className="theme-logo-image-light" src="/Logo-Dark-Transparent.png" />
            <span>WeVid</span>
          </Link>

          <nav className="rail-nav">
            {appShellNavItems.map((item) => (
              <Link
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className="rail-link"
                data-active={isActive(pathname, item.href) ? "true" : "false"}
                href={item.href as Route}
                key={item.href}
              >
                <ShellIcon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="app-main">
          <header className="top-bar">
            <Link className="mobile-brand" href="/app/home" aria-label="WeVid app home">
              <img alt="" className="theme-logo-image-dark" src="/Logo-Light-Transparent.png" />
              <img alt="" className="theme-logo-image-light" src="/Logo-Dark-Transparent.png" />
              <span>WeVid</span>
            </Link>
            <Link className="top-search" href="/app/bits" aria-label="Search">
              <Search aria-hidden="true" size={17} />
              <span>Search creators, live, events</span>
            </Link>
            <nav className="top-actions" aria-label="Secondary">
              <ThemeToggle />
              {appShellTopActionItems.map((item) => (
                <Link
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  aria-label={item.label}
                  className="top-action"
                  data-active={isActive(pathname, item.href) ? "true" : "false"}
                  title={item.label}
                  href={item.href as Route}
                  key={item.href}
                >
                  <ShellIcon name={item.icon} />
                  <span className="top-action-label">{item.label}</span>
                </Link>
              ))}
            </nav>
          </header>

          <div className="page-frame">{children}</div>
        </div>

        <nav className="bottom-nav" aria-label="Primary mobile">
          {appShellNavItems.map((item) => (
            <Link
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className="bottom-link"
              data-active={isActive(pathname, item.href) ? "true" : "false"}
              href={item.href as Route}
              key={item.href}
            >
              <ShellIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}

function ShellIcon({ name }: { name: string }) {
  const icons: Record<string, LucideIcon> = {
    bits: Clapperboard,
    create: PlusSquare,
    home: Home,
    messages: MessageCircle,
    notifications: Bell,
    profile: UserRound,
    settings: Settings,
    subscriptions: Bell,
    wallet: WalletCards
  };
  const Icon = icons[name] ?? Compass;

  return <Icon aria-hidden="true" size={18} strokeWidth={1.9} />;
}

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
