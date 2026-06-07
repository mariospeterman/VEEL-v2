import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "./app-dependencies.js";

type ClosableDependency = {
  close?: () => Promise<void>;
};

const repositoryKeys = [
  "sessionRepository",
  "ageRepository",
  "profileRepository",
  "walletRepository",
  "contentRepository",
  "mutualsRepository",
  "discoverRepository",
  "eventRepository",
  "engagementRepository",
  "liveRepository",
  "messageRepository",
  "paymentRepository",
  "paymentEvidenceRepository",
  "activityRepository",
  "referralRepository",
  "refundRepository",
  "notificationRepository",
  "organizationRepository",
  "subscriptionRepository",
  "adminRepository",
  "aiRepository"
] as const;

export function registerApiCloseHooks(app: FastifyInstance, dependencies: ApiDependencies): void {
  if (dependencies.postgresClient?.end) {
    app.addHook("onClose", async () => {
      await dependencies.postgresClient?.end({ timeout: 5 });
    });
  }

  for (const key of repositoryKeys) {
    const dependency = dependencies[key] as ClosableDependency;
    if (dependency.close) {
      app.addHook("onClose", async () => {
        await dependency.close?.();
      });
    }
  }
}
