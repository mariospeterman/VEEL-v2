import { metrics } from "@opentelemetry/api";
import type { FastifyInstance } from "fastify";
import { contractRouteSchema } from "../../shared/openapi-route-schema.js";

export interface WebVitalMetric {
  name: "CLS" | "FCP" | "INP" | "LCP" | "TTFB";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  navigationType: "navigate" | "reload" | "back-forward" | "back-forward-cache" | "prerender" | "restore";
  id: string;
}

export type WebVitalRecorder = (metric: WebVitalMetric) => void;

const meter = metrics.getMeter("wevid-api");
const histograms = {
  CLS: meter.createHistogram("wevid.web.vital.cls", { unit: "1" }),
  FCP: meter.createHistogram("wevid.web.vital.fcp", { unit: "ms" }),
  INP: meter.createHistogram("wevid.web.vital.inp", { unit: "ms" }),
  LCP: meter.createHistogram("wevid.web.vital.lcp", { unit: "ms" }),
  TTFB: meter.createHistogram("wevid.web.vital.ttfb", { unit: "ms" })
};

const defaultRecorder: WebVitalRecorder = (metric) => {
  histograms[metric.name].record(metric.value, {
    "web.vital.rating": metric.rating,
    "web.navigation.type": metric.navigationType
  });
};

const allowedFields = new Set(["name", "value", "rating", "navigationType", "id"]);

export async function registerTelemetryRoutes(
  app: FastifyInstance,
  recorder: WebVitalRecorder = defaultRecorder
): Promise<void> {
  app.post(
    "/v1/telemetry/web-vitals",
    {
      schema: contractRouteSchema("recordWebVital"),
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      preValidation(request, reply, done) {
        const body = request.body;
        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          Object.keys(body).some((field) => !allowedFields.has(field))
        ) {
          void reply.code(400).send({ code: "validation_failed", message: "Unexpected telemetry field" });
          return;
        }
        done();
      }
    },
    async (request, reply) => {
      recorder(request.body as WebVitalMetric);
      return reply.code(202).send();
    }
  );
}
