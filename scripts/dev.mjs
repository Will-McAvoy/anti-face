import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
const server = await createServer();
await server.listen();
const env = { ...process.env, ANTI_FACE_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], { stdio: "inherit", env });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (child.exitCode === null) child.kill();
  await server.close();
  process.exit(code);
}
child.on("exit", (code) => close(code ?? 0));
child.on("error", (error) => {
  console.error(error);
  close(1);
});
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
