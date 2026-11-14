#!/usr/bin/env node
/**
 * `npm run gen:api` — regenerate the typed API client schema from the FastAPI app.
 *
 * 1. Dumps the OpenAPI document straight from the Python app (no server needed):
 *    `<venv python> -c "…create_app().openapi()"` → src/api/openapi.json
 *    The interpreter is the repository's virtualenv: `.venv/Scripts/python.exe` on Windows,
 *    `.venv/bin/python` elsewhere (override with EXOFINDER_PYTHON).
 * 2. Runs openapi-typescript on it → src/api/schema.d.ts
 *
 * Both outputs are committed so the frontend builds without Python installed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const repo = resolve(frontend, "..");
const backend = join(repo, "backend");
const outDir = join(frontend, "src", "api");
const jsonPath = join(outDir, "openapi.json");
const dtsPath = join(outDir, "schema.d.ts");

function findPython() {
  if (process.env.EXOFINDER_PYTHON) return process.env.EXOFINDER_PYTHON;
  const candidates =
    process.platform === "win32"
      ? [join(repo, ".venv", "Scripts", "python.exe"), join(repo, "venv", "Scripts", "python.exe")]
      : [join(repo, ".venv", "bin", "python"), join(repo, "venv", "bin", "python")];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error(`No Python virtualenv found (looked for ${candidates.join(", ")}).`);
    console.error("Run setup first (setup.ps1 / scripts/setup.sh), or set EXOFINDER_PYTHON.");
    process.exit(1);
  }
  return found;
}

const python = findPython();
const code = [
  "import json, sys",
  "from exofinder.api.main import create_app",
  "sys.stdout.write(json.dumps(create_app().openapi(), indent=2, sort_keys=False))",
].join("; ");

console.log(`[gen:api] dumping OpenAPI with ${python}`);
const spec = execFileSync(python, ["-c", code], {
  cwd: backend,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: [backend, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":") },
});
const parsed = JSON.parse(spec); // fail loudly on anything that is not JSON
mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(`[gen:api] wrote ${jsonPath} (${Object.keys(parsed.paths ?? {}).length} paths)`);

const openapiTS = (await import("openapi-typescript")).default;
const { astToString } = await import("openapi-typescript");
const ast = await openapiTS(parsed, { alphabetize: false, exportType: false });
const header =
  "/**\n" +
  " * GENERATED FILE — do not edit by hand. Run `npm run gen:api` to regenerate from the FastAPI app\n" +
  " * (src/api/openapi.json is the snapshot this was generated from).\n" +
  " */\n\n";
writeFileSync(dtsPath, header + astToString(ast));
console.log(`[gen:api] wrote ${dtsPath}`);
