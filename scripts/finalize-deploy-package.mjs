#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || directory === path.parse(directory).root) throw new Error("A deploy package directory is required");
const packagePath = path.join(directory, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
packageJson.type = "module";
delete packageJson.devDependencies;
delete packageJson.scripts;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, { mode: 0o644 });
console.log(`Finalized ESM production package ${packageJson.name}`);
