import { createElement } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const appShellNavItems = [
  { href: "/app/home", icon: "home", label: "Home" },
  { href: "/app/bits", icon: "bits", label: "Bits" },
  { href: "/app/create", icon: "create", label: "Create" },
  { href: "/app/messages", icon: "messages", label: "Messages" },
  { href: "/app/profile", icon: "profile", label: "Profile" }
] as const;

export const appShellTopActionItems = [
  { href: "/app/wallet", icon: "wallet", label: "Wallet" },
  { href: "/app/notifications", icon: "notifications", label: "Notifications" },
  { href: "/app/subscriptions", icon: "subscriptions", label: "Subscriptions" },
  { href: "/app/settings", icon: "settings", label: "Settings" }
] as const;

type ButtonTone = "primary" | "secondary" | "ghost";
type CardTone = "default" | "muted" | "media";
type StatusTone = "neutral" | "good" | "warn" | "danger";

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function buttonClassName(tone: ButtonTone = "secondary", className = "") {
  const toneClass =
    tone === "primary"
      ? "primary-button"
      : tone === "ghost"
        ? "ghost-button"
        : "secondary-button";

  return joinClassNames(toneClass, className);
}

export function Button({
  children,
  className,
  tone = "secondary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: ButtonTone;
}) {
  return createElement(
    "button",
    { className: buttonClassName(tone, className), type, ...props },
    children
  );
}

export function ButtonLink({
  children,
  className,
  tone = "secondary",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  tone?: ButtonTone;
}) {
  return createElement("a", { className: buttonClassName(tone, className), ...props }, children);
}

export function IconButton({
  children,
  className,
  label,
  tone = "ghost",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
  tone?: ButtonTone;
}) {
  return createElement(
    "button",
    {
      "aria-label": label,
      className: joinClassNames("icon-button", buttonClassName(tone), className),
      type,
      ...props
    },
    children
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
  action
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return createElement(
    "header",
    { className: "page-header" },
    createElement(
      "div",
      null,
      createElement("p", { className: "eyebrow" }, eyebrow),
      createElement("h1", null, title),
      children ? createElement("p", { className: "page-kicker" }, children) : null
    ),
    action ? createElement("div", { className: "page-action" }, action) : null
  );
}

export function Card({
  children,
  className = "",
  id,
  tone = "default"
}: {
  children?: ReactNode;
  className?: string;
  id?: string;
  tone?: CardTone;
}) {
  return createElement("section", { className: joinClassNames("ui-card", className), "data-tone": tone, id }, children);
}

export function EmptyState({
  title,
  children,
  action
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return createElement(
    Card,
    { className: "empty-state" },
    createElement("h2", null, title),
    children ? createElement("p", null, children) : null,
    action ? createElement("div", { className: "mt-4" }, action) : null
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return createElement("span", { className: "status-pill", "data-tone": tone }, children);
}

export function Avatar({
  alt = "",
  fallback,
  size = "md",
  src
}: {
  alt?: string;
  fallback: string;
  size?: "sm" | "md" | "lg";
  src?: string | null;
}) {
  return createElement(
    "span",
    { className: "avatar", "data-size": size },
    src ? createElement("img", { alt, src }) : createElement("span", { "aria-hidden": alt ? undefined : "true" }, fallback.slice(0, 2).toUpperCase())
  );
}

export function Field({
  children,
  hint,
  label
}: {
  children: ReactNode;
  hint?: ReactNode;
  label: string;
}) {
  return createElement(
    "label",
    { className: "ui-field" },
    createElement("span", null, label),
    children,
    hint ? createElement("small", null, hint) : null
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return createElement("input", { className: joinClassNames("ui-input", className), ...props });
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return createElement("textarea", { className: joinClassNames("ui-input", "ui-textarea", className), ...props });
}

export function Tabs({
  items
}: {
  items: Array<{ active?: boolean; href: string; label: string }>;
}) {
  return createElement(
    "nav",
    { className: "ui-tabs", "aria-label": "View options" },
    items.map((item) =>
      createElement(
        "a",
        {
          "aria-current": item.active ? "page" : undefined,
          "data-active": item.active ? "true" : "false",
          href: item.href,
          key: item.href
        },
        item.label
      )
    )
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return createElement(
    "div",
    { className: "fact" },
    createElement("p", null, label),
    createElement("strong", null, value)
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return createElement(
    Card,
    { className: "metric-card" },
    createElement("p", null, label),
    createElement("strong", null, value)
  );
}

export function MediaTile({
  action,
  badges,
  eyebrow,
  href,
  meta,
  posterUrl,
  title
}: {
  action?: ReactNode;
  badges?: ReactNode;
  eyebrow?: ReactNode;
  href?: string;
  meta?: ReactNode;
  posterUrl?: string | null | undefined;
  title: string;
}) {
  const media = createElement(
    Card,
    { className: "media-tile", tone: "media" },
    createElement(
      "div",
      { className: "media-tile-preview" },
      posterUrl
        ? createElement("img", { alt: "", src: posterUrl })
        : createElement("span", null, "Media preview"),
      badges ? createElement("div", { className: "media-tile-badges" }, badges) : null
    ),
    createElement(
      "div",
      { className: "media-tile-body" },
      createElement(
        "div",
        { className: "media-tile-copy" },
        eyebrow ? createElement("p", null, eyebrow) : null,
        createElement("h2", null, title),
        meta ? createElement("div", { className: "media-tile-meta" }, meta) : null
      ),
      action ? createElement("div", { className: "media-tile-action" }, action) : null
    )
  );

  return href ? createElement("a", { className: "media-tile-link", href }, media) : media;
}
