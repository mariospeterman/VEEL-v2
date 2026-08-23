import type { CreateContentRequest } from "@/api-mutations";

export const visibilityValues: CreateContentRequest["visibility"][] = [
  "public",
  "followers",
  "subscribers",
  "private"
];

export const nsfwLabels: CreateContentRequest["nsfwLabel"][] = [
  "none",
  "adult",
  "explicit"
];

export const representationModes: CreateContentRequest["representationMode"][] = [
  "self_only",
  "no_real_person",
  "declared_performers"
];
