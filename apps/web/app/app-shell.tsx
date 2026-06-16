"use client";

import { appShellNavItems, appShellTopActionItems } from "@veel/ui";
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
          <Link className="brand-lockup" href="/app/home" aria-label="VEEL app home">
            <span aria-hidden="true" className="theme-logo theme-logo-dark" />
            <span aria-hidden="true" className="theme-logo theme-logo-light" />
            <span>VEEL</span>
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
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="app-main">
          <header className="top-bar">
            <Link className="mobile-brand" href="/app/home" aria-label="VEEL app home">
              <span aria-hidden="true" className="theme-logo theme-logo-dark" />
              <span aria-hidden="true" className="theme-logo theme-logo-light" />
              <span>VEEL</span>
            </Link>
            <Link className="top-search" href="/app/bits" aria-label="Search">
              Search creators, live, events
            </Link>
            <nav className="top-actions" aria-label="Secondary">
              <ThemeToggle />
              {appShellTopActionItems.map((item) => (
                <Link
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="top-action"
                  data-active={isActive(pathname, item.href) ? "true" : "false"}
                  href={item.href as Route}
                  key={item.href}
                >
                  {item.label}
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
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
