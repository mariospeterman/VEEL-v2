export {};

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
const disabled = process.env.OTEL_SDK_DISABLED === "true";

if (!disabled && !endpoint && process.env.OTEL_REQUIRED === "true") {
  throw new Error("OTEL_REQUIRED=true requires OTEL_EXPORTER_OTLP_ENDPOINT");
}

if (!disabled && endpoint) {
  const [instrumentationsModule, metricsExporterModule, traceExporterModule, metricsModule, sdkModule] =
    await Promise.all([
      import("@opentelemetry/auto-instrumentations-node"),
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
      import("@opentelemetry/sdk-node")
    ]);
  const sdk = new sdkModule.NodeSDK({
    traceExporter: new traceExporterModule.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new metricsModule.PeriodicExportingMetricReader({
      exporter: new metricsExporterModule.OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000)
    }),
    instrumentations: [instrumentationsModule.getNodeAutoInstrumentations()]
  });
  sdk.start();
  process.once("beforeExit", () => void sdk.shutdown());
}
