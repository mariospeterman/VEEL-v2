import { buildApi } from "./app.js";
import { createApiShutdownController } from "./api-shutdown.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApi();
const shutdown = createApiShutdownController(app);
const removeSignalHandlers = shutdown.installSignalHandlers();

try {
  await app.listen({ host, port });
} catch (error) {
  removeSignalHandlers();
  app.log.error(error);
  try {
    await app.close();
  } catch (closeError) {
    app.log.error({ closeError }, "API cleanup after startup failure failed");
  }
  process.exitCode = 1;
}
