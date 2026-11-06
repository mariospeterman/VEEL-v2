import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020, { type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type JsonObject = Record<string, unknown>;

const openapiPath = fileURLToPath(new URL("../openapi.yaml", import.meta.url));
const openapiSource = readFileSync(openapiPath, "utf8");
const document = parse(openapiSource) as JsonObject;
const components = document.components as JsonObject;
const schemas = (components.schemas ?? {}) as Record<string, JsonObject>;

const schema = (name: string): JsonObject => {
  const value = schemas[name];
  if (!value) throw new Error(`Missing OpenAPI component schema: ${name}`);
  return value;
};

const propertiesOf = (name: string): Record<string, JsonObject> => {
  const properties = schema(name).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`OpenAPI component schema ${name} has no properties object`);
  }
  return properties as Record<string, JsonObject>;
};

const propertyOf = (schemaName: string, propertyName: string): JsonObject => {
  const property = propertiesOf(schemaName)[propertyName];
  if (!property) {
    throw new Error(`OpenAPI component schema ${schemaName} has no ${propertyName} property`);
  }
  return property;
};

const collectKeywordPaths = (
  value: unknown,
  keyword: string,
  path = "$",
  matches: string[] = [],
): string[] => {
  if (!value || typeof value !== "object") return matches;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeywordPaths(item, keyword, `${path}[${index}]`, matches));
    return matches;
  }

  for (const [key, child] of Object.entries(value as JsonObject)) {
    const childPath = `${path}.${key}`;
    if (key === keyword) matches.push(childPath);
    collectKeywordPaths(child, keyword, childPath, matches);
  }
  return matches;
};

const compileComponent = (name: string): ValidateFunction => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: `#/components/schemas/${name}`,
    components: { schemas },
  } as AnySchema);
};

const expectValid = (validate: ValidateFunction, value: unknown): void => {
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
};

const expectInvalid = (validate: ValidateFunction, value: unknown): void => {
  expect(validate(value)).toBe(false);
};

describe("OpenAPI 3.1 schema semantics", () => {
  it("contains no legacy nullable keywords", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(collectKeywordPaths(document, "nullable")).toEqual([]);
    expect(openapiSource).not.toMatch(/(^|[,{]\s*)nullable\s*:/m);
  });

  it("represents nullable scalars, enums, objects, and references as JSON Schema unions", () => {
    expect(propertyOf("MessagePage", "nextCursor").type).toEqual(["string", "null"]);

    const nullableEnum = propertyOf("CreatorOnboardingConfiguration", "earningsTermsVersion");
    expect(nullableEnum.type).toEqual(["string", "null"]);
    expect(nullableEnum.enum).toEqual(["wevid-creator-earnings-v1", null]);

    const nullableObject = propertyOf("Notification", "relatedResource");
    expect(nullableObject.type).toEqual(["object", "null"]);

    const nullableReference = propertyOf("PublicCreatorMonetisation", "membershipOffer");
    expect(nullableReference).toEqual({
      anyOf: [
        { $ref: "#/components/schemas/SubscriptionPlan" },
        { type: "null" },
      ],
    });
  });

  it("validates representative null and non-null values with a Draft 2020-12 validator", () => {
    const messagePage = compileComponent("MessagePage");
    expectValid(messagePage, { items: [], nextCursor: null });
    expectValid(messagePage, { items: [], nextCursor: "cursor-1" });
    expectInvalid(messagePage, { items: [], nextCursor: 1 });

    const onboarding = compileComponent("CreatorOnboardingConfiguration");
    expectValid(onboarding, {
      recipientWalletId: null,
      earningsTermsVersion: null,
      products: {
        support: false,
        contentUnlocks: false,
        eventAccessAndLive: false,
        paidMessages: false,
        memberships: false,
      },
    });
    expectInvalid(onboarding, {
      recipientWalletId: null,
      earningsTermsVersion: "unpublished-version",
      products: {
        support: false,
        contentUnlocks: false,
        eventAccessAndLive: false,
        paidMessages: false,
        memberships: false,
      },
    });

    const notification = compileComponent("Notification");
    const notificationBase = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "message",
      title: "Updated",
      state: "unread",
      createdAt: "2026-11-04T12:00:00Z",
    };
    expectValid(notification, { ...notificationBase, relatedResource: null });
    expectValid(notification, {
      ...notificationBase,
      relatedResource: { type: "content", id: null },
    });
    expectInvalid(notification, { ...notificationBase, relatedResource: "content" });

    const monetisation = compileComponent("PublicCreatorMonetisation");
    const monetisationBase = {
      supportEnabled: true,
      contentUnlocksEnabled: true,
      livePassesEnabled: true,
      paidMessagesEnabled: true,
      subscriptionsEnabled: true,
    };
    expectValid(monetisation, { ...monetisationBase, membershipOffer: null });
    expectValid(monetisation, {
      ...monetisationBase,
      membershipOffer: {
        id: "plan-1",
        scope: "creator",
        label: "Monthly",
        description: null,
        benefits: [],
        amountMinor: 500,
        currency: "SOL",
        assetDecimals: 9,
        periodDays: 30,
        billingMode: "manual_solana_pay",
        providerState: "staging_required",
        provider: "mock_subscription_provider_dev_only",
      },
    });
    expectInvalid(monetisation, { ...monetisationBase, membershipOffer: "plan-1" });
  });

  it("requires a complete age-session resource for durable and direct handoffs", () => {
    const ageSession = compileComponent("AgeSession");

    expectValid(ageSession, {
      id: "00000000-0000-4000-8000-000000000138",
      provider: null,
      providerReference: null,
      launchUrl: null,
      expiresAt: null,
      launchState: "reserved",
      status: "created",
      resumable: false,
    });
    expectValid(ageSession, {
      id: "yoti-session-1",
      provider: "yoti",
      providerReference: "yoti-session-1",
      launchUrl: "https://age.example.test/session/yoti-session-1",
      expiresAt: "2026-06-03T22:15:00.000Z",
      launchState: "ready",
      status: "pending",
      resumable: false,
    });
    expectInvalid(ageSession, {
      id: "yoti-session-1",
      provider: "yoti",
      launchUrl: "https://age.example.test/session/yoti-session-1",
      expiresAt: "2026-06-03T22:15:00.000Z",
    });
  });

  it("keeps sensitive playback capabilities response-only", () => {
    const jwt = propertyOf("PlaybackResource", "jwt");
    expect(jwt.readOnly).toBe(true);
    expect(jwt.writeOnly).toBeUndefined();
    expect(jwt.type).toEqual(["string", "null"]);
  });

  it("keeps public and admin payment state vocabularies identical", () => {
    const publicStates = propertyOf("PaymentIntent", "state").enum;
    const adminStates = propertyOf("AdminPaymentIntent", "state").enum;
    expect(adminStates).toEqual(publicStates);
  });

  it("requires suppressed analytics points to hide their sample size", () => {
    const metricPoint = compileComponent("AnalyticsMetricPoint");
    const suppressed = {
      bucketDate: null,
      value: null,
      numerator: null,
      denominator: null,
      sampleSize: null,
      privacyDecision: "suppressed_minimum_cohort",
    };
    expectValid(metricPoint, suppressed);
    expectInvalid(metricPoint, { ...suppressed, sampleSize: "3" });

    const released = {
      bucketDate: null,
      value: "6",
      numerator: null,
      denominator: null,
      sampleSize: "6",
      privacyDecision: "released",
    };
    expectValid(metricPoint, released);
    expectInvalid(metricPoint, { ...released, sampleSize: null });
  });

  it("contracts provider-specific age webhook authentication and acknowledgements", () => {
    const paths = document.paths as Record<string, JsonObject>;
    expect(paths["/v1/webhooks/age/{provider}"]).toBeUndefined();

    const sumsub = paths["/v1/webhooks/age/sumsub"]?.post as JsonObject;
    const sumsubParameters = sumsub.parameters as JsonObject[];
    expect(sumsub.operationId).toBe("receiveSumsubAgeWebhook");
    expect(sumsubParameters).toEqual([
      { $ref: "#/components/parameters/SumsubPayloadDigest" },
      { $ref: "#/components/parameters/SumsubPayloadDigestAlgorithm" },
    ]);
    expect(Object.keys(sumsub.responses as JsonObject)).toContain("202");

    const yoti = paths["/v1/webhooks/age/yoti"]?.post as JsonObject;
    expect(yoti.operationId).toBe("receiveYotiAgeWebhook");
    expect(Object.keys(yoti.responses as JsonObject)).toContain("200");
    expect(Object.keys(yoti.responses as JsonObject)).not.toContain("202");
  });
});
