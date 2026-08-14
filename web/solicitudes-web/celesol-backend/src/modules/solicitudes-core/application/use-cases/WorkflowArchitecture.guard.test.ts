import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const USE_CASES_ROOT = path.resolve(
  process.cwd(),
  "src/modules/solicitudes-core/application/use-cases",
);

describe("Workflow architecture guard-rails", () => {
  it("does not allow direct executeWorkflowPlan calls from use-cases", () => {
    const offenders: string[] = [];

    for (const file of listTypeScriptFiles(USE_CASES_ROOT)) {
      const relative = normalize(path.relative(USE_CASES_ROOT, file));
      const source = fs.readFileSync(file, "utf-8");

      if (!/\bexecuteWorkflowPlan\s*\(/.test(source)) {
        continue;
      }

      offenders.push(relative);
    }

    assert.deepEqual(
      offenders,
      [],
      `Found use-cases calling executeWorkflowPlan directly: ${offenders.join(", ")}`,
    );
  });
});

function listTypeScriptFiles(root: string) {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalize(value: string) {
  return value.replace(/\\/g, "/");
}
