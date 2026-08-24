const scopeLabels: Record<string, string> = {
  "creator.profile.read": "View your profile readiness",
  "creator.metrics.read": "View your creator analytics",
  "creator.drafts.read": "View your private drafts",
  "creator.drafts.write": "Prepare private drafts",
  "admin.health.read": "View platform health",
  "admin.support.read": "View support cases",
  "admin.payments.read": "View payment reconciliation summaries"
};

const toolLabels: Record<string, { title: string; description: string }> = {
  creator_get_profile: {
    title: "Profile and onboarding readiness",
    description: "See a minimized profile and the next setup step, without wallet details or earnings records."
  },
  creator_query_analytics: {
    title: "Creator analytics",
    description: "Ask for approved Analytics Core metrics with the same freshness and privacy rules as WeVid."
  },
  creator_list_private_drafts: {
    title: "Private draft list",
    description: "See bounded draft metadata only. Media URLs and private content are not returned."
  },
  creator_get_draft_readiness: {
    title: "Draft readiness",
    description: "Check what an owned private draft still needs before you continue in WeVid."
  },
  creator_create_private_draft: {
    title: "Prepare a private draft",
    description: "Create an SFW private draft for your review. The assistant cannot publish it."
  },
  admin_get_platform_health_summary: {
    title: "Platform health",
    description: "Read the operations health summary available to authorized staff."
  },
  admin_list_support_cases: {
    title: "Support cases",
    description: "Read bounded support-case summaries available to authorized staff."
  },
  admin_list_payment_intents: {
    title: "Payment reconciliation",
    description: "Read payment-intent summaries available to authorized finance staff."
  }
};

export function mcpScopeLabel(scope: string): string {
  return scopeLabels[scope] ?? scope.split(".").slice(1).join(" ").replaceAll("_", " ");
}

export function mcpToolLabel(name: string): { title: string; description: string } {
  return toolLabels[name] ?? {
    title: name.split("_").slice(1).join(" ").replaceAll("_", " "),
    description: "A permission-scoped WeVid capability."
  };
}

export function mcpAuthLabel(mode: "scoped_token" | "oauth"): string {
  return mode === "oauth" ? "Secure sign-in approval" : "Development access token";
}

export function mcpRoleLabel(role: "creator" | "admin"): string {
  return role === "admin" ? "Staff tools" : "Creator tools";
}

export function mcpClientTypeLabel(clientType: string): string {
  const labels: Record<string, string> = {
    claude: "Claude",
    claude_code: "Claude Code",
    cursor: "Cursor",
    openai: "OpenAI",
    custom: "Custom assistant",
    internal: "WeVid"
  };
  return labels[clientType] ?? "Connected assistant";
}

export function mcpConnectionStateLabel(state: string): string {
  const labels: Record<string, string> = {
    active: "Active",
    pending: "Awaiting approval",
    revoked: "Revoked",
    expired: "Expired",
    denied: "Not approved"
  };
  return labels[state] ?? "Unavailable";
}

export function formatMcpLastUsed(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date) + " UTC";
}
