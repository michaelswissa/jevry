import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "desktop/engine.test.ts", "desktop/page-evidence.test.ts", "desktop/challenges.test.ts"],
  { stdio: "inherit", env: { ...process.env, JEVRY_BROWSER_TEST: "1" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
