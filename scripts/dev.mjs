import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
await import("./build-desktop.mjs");
const server = await createServer();
await server.listen();
server.printUrls();
const env = { ...process.env, JEVRY_DEV_URL: "http://127.0.0.1:5183" };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electron, ["."], { stdio: "inherit", env });
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => app.kill());
