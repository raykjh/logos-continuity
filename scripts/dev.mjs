import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["server/index.ts"], { stdio: "inherit" }),
  spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "vite"], {
    stdio: "inherit",
    shell: process.platform === "win32"
  })
];

const stop = () => {
  for (const child of children) {
    child.kill();
  }
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stop();
      process.exitCode = code;
    }
  });
}
