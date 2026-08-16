import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { FastifySchema } from "fastify";

type JsonObject = Record<string, unknown>;

const contractPath = fileURLToPath(import.meta.resolve("@veel/contracts/openapi.yaml"));
const contract = YAML.parse(readFileSync(contractPath, "utf8")) as JsonObject;

export function contractRouteSchema(operationId: string): FastifySchema {
  const { operation, pathItem } = findOperation(operationId);
  const requestBody = dereference(operation.requestBody) as JsonObject | undefined;
  const content = requestBody?.content as JsonObject | undefined;
  const mediaType = content?.["application/json"] as JsonObject | undefined;
  const schema = mediaType?.schema;
  const responses = operation.responses as JsonObject | undefined;
  const responseSchemas = Object.fromEntries(
    Object.entries(responses ?? {}).flatMap(([status, response]) => {
      const resolvedResponse = dereference(response) as JsonObject | undefined;
      const responseContent = resolvedResponse?.content as JsonObject | undefined;
      const responseMediaType = responseContent?.["application/json"] as JsonObject | undefined;
      return responseMediaType?.schema
        ? [[status, dereferenceDeep(responseMediaType.schema)]]
        : [];
    })
  );
  const parameterSchemas = compileParameters([
    ...toArray(pathItem.parameters),
    ...toArray(operation.parameters)
  ]);

  return {
    ...parameterSchemas,
    ...(schema ? { body: dereferenceDeep(schema) } : {}),
    ...(Object.keys(responseSchemas).length > 0 ? { response: responseSchemas } : {})
  };
}

function findOperation(operationId: string): { operation: JsonObject; pathItem: JsonObject } {
  const paths = contract.paths as JsonObject;
  for (const pathItem of Object.values(paths)) {
    if (!isObject(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (isObject(operation) && operation.operationId === operationId) {
        return { operation, pathItem };
      }
    }
  }
  throw new Error(`OpenAPI operation not found: ${operationId}`);
}

function compileParameters(parameters: unknown[]): Partial<Pick<FastifySchema, "headers" | "params" | "querystring">> {
  const groups: Record<"headers" | "params" | "querystring", { properties: JsonObject; required: string[] }> = {
    headers: { properties: {}, required: [] },
    params: { properties: {}, required: [] },
    querystring: { properties: {}, required: [] }
  };

  for (const parameterValue of parameters) {
    const parameter = dereference(parameterValue);
    if (!isObject(parameter) || typeof parameter.name !== "string" || typeof parameter.in !== "string") continue;
    const groupName = parameter.in === "header"
      ? "headers"
      : parameter.in === "path"
        ? "params"
        : parameter.in === "query"
          ? "querystring"
          : null;
    if (!groupName) continue;
    const name = groupName === "headers" ? parameter.name.toLowerCase() : parameter.name;
    groups[groupName].properties[name] = dereferenceDeep(parameter.schema ?? {});
    if (parameter.required === true) groups[groupName].required.push(name);
  }

  return Object.fromEntries(
    Object.entries(groups).flatMap(([name, group]) =>
      Object.keys(group.properties).length > 0
        ? [[name, {
            type: "object",
            properties: group.properties,
            ...(group.required.length > 0 ? { required: group.required } : {})
          }]]
        : []
    )
  );
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dereferenceDeep(value: unknown): unknown {
  const resolved = dereference(value);
  if (Array.isArray(resolved)) return resolved.map(dereferenceDeep);
  if (!isObject(resolved)) return resolved;
  return Object.fromEntries(Object.entries(resolved).map(([key, child]) => [key, dereferenceDeep(child)]));
}

function dereference(value: unknown): unknown {
  if (!isObject(value) || typeof value.$ref !== "string") return value;
  const segments = value.$ref.replace(/^#\//, "").split("/");
  let current: unknown = contract;
  for (const segment of segments) {
    if (!isObject(current)) throw new Error(`Invalid OpenAPI reference: ${value.$ref}`);
    current = current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return current;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
