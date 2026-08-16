import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import swagger from "@fastify/swagger";
import type { OpenAPIV3 } from "openapi-types";
import fp from "fastify-plugin";
import YAML from "yaml";

const openApiPath = fileURLToPath(import.meta.resolve("@veel/contracts/openapi.yaml"));

export const openApiPlugin = fp(async (app) => {
  const openApiText = await readFile(openApiPath, "utf8");
  const openApiDocument = YAML.parse(openApiText) as OpenAPIV3.Document;

  await app.register(swagger, {
    mode: "static",
    specification: {
      document: openApiDocument
    }
  });
});
