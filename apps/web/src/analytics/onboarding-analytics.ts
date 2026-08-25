"use client";

import { recordOnboardingAnalyticsEvent } from "@/api-mutations";

export type OnboardingAnalyticsEventKey =
  | "landing_viewed"
  | "landing_cta_clicked"
  | "landing_nav_clicked"
  | "landing_section_viewed"
  | "landing_money_example_viewed"
  | "landing_comparison_viewed"
  | "landing_faq_opened"
  | "login_opened"
  | "onboarding_opened"
  | "auth_method_selected"
  | "wallet_runtime_ready"
  | "wallet_authentication_completed"
  | "wallet_ownership_verified"
  | "profile_step_viewed"
  | "profile_step_completed"
  | "age_step_started"
  | "age_step_completed"
  | "age_step_failed"
  | "protected_app_entered"
  | "onboarding_abandoned"
  | "returning_login_completed"
  | "account_not_found";

const journeyStorageKey = "wevid:onboarding-journey";
const emittedStorageKey = "wevid:onboarding-events";
let memoryJourneyId: string | null = null;

export {
  consumeExpectedOnboardingJourneyExit,
  markOnboardingJourneyHandoff
} from "./onboarding-journey-handoff";

export function recordOnboardingEvent(eventKey: OnboardingAnalyticsEventKey, occurrence = "once"): void {
  if (typeof window === "undefined") return;
  const journeyId = onboardingJourneyId();
  const idempotencyKey = `${eventKey}:${occurrence}`;
  const emitted = readEmittedEvents();
  if (emitted.has(idempotencyKey)) return;
  emitted.add(idempotencyKey);
  writeEmittedEvents(emitted);

  void recordOnboardingAnalyticsEvent({
    journeyId,
    eventKey,
    idempotencyKey,
    occurredAt: new Date().toISOString()
  }).catch(() => {
    // Product behavior never depends on analytics delivery.
  });
}

export function onboardingJourneyId(): string {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000000";
  const existing = safeSessionRead(journeyStorageKey);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  memoryJourneyId ??= crypto.randomUUID();
  safeSessionWrite(journeyStorageKey, memoryJourneyId);
  return memoryJourneyId;
}

function readEmittedEvents(): Set<string> {
  return new Set(safeSessionRead(emittedStorageKey)?.split(",").filter(Boolean) ?? []);
}

function writeEmittedEvents(events: Set<string>) {
  safeSessionWrite(emittedStorageKey, [...events].slice(-64).join(","));
}

function safeSessionRead(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionWrite(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Privacy modes may deny storage; the in-memory journey remains sufficient.
  }
}
