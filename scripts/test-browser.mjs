import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  // Browser launch on a cold CI runner can exceed the unit-test default of 5s.
  // Runtime deadlines and explicit per-test limits remain unchanged.
  ["node_modules/vitest/vitest.mjs", "run", "--testTimeout=15000", "desktop/engine.test.ts", "desktop/page-evidence.test.ts", "desktop/challenges.test.ts"],
  { stdio: "inherit", env: { ...process.env, JEVRY_BROWSER_TEST: "1" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
