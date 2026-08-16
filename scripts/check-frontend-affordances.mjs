import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const webRoot = path.resolve("apps/web");
const files = await collectTsxFiles(webRoot);
const failures = [];

for (const file of files) {
  const sourceText = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attributes = jsxAttributes(node);

      if (
        tag === "button" &&
        stringAttribute(attributes.get("type")) === "button" &&
        !attributes.has("onClick") &&
        !attributes.has("disabled")
      ) {
        failures.push(failure(file, source, node, "enabled type=button control has no onClick owner"));
      }

      if ((tag === "a" || tag === "Link") && inertHref(attributes.get("href"))) {
        failures.push(failure(file, source, node, "link uses an empty or # fallback destination"));
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
}

if (failures.length > 0) {
  console.error("Frontend affordance ownership check failed:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Frontend affordance ownership check passed (${files.length} TSX files).`);

async function collectTsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(target);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [target] : [];
  }));
  return nested.flat().sort();
}

function jsxAttributes(node) {
  const attributes = new Map();
  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(), property.initializer);
  }
  return attributes;
}

function stringAttribute(initializer) {
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : null;
}

function inertHref(initializer) {
  if (!initializer) return false;
  if (ts.isStringLiteral(initializer)) return initializer.text === "" || initializer.text === "#";
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return false;

  const expression = initializer.expression;
  if (ts.isStringLiteral(expression)) return expression.text === "" || expression.text === "#";
  return ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    ts.isStringLiteral(expression.right) &&
    (expression.right.text === "" || expression.right.text === "#");
}

function failure(file, source, node, message) {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${path.relative(process.cwd(), file)}:${position.line + 1}:${position.character + 1} ${message}`;
}
