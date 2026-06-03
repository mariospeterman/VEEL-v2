import { parseServerEnv } from "@veel/config";

export const buildWorkerRuntime = () => {
  const config = parseServerEnv(process.env);

  return {
    name: "veel-worker",
    environment: config.NODE_ENV,
    queues: [] as string[]
  };
};

if (process.env.NODE_ENV !== "test") {
  const runtime = buildWorkerRuntime();
  console.log(`${runtime.name} ready in ${runtime.environment}`);
}
