import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/\.scripts$/, "")
console.error(`dev: cwd=${root}`)

const apps = [
  { name: "server", cwd: resolve(root, "server"), cmd: "bun", args: ["run", "dev"] },
  { name: "web-next", cwd: resolve(root, "web-next"), cmd: "npm", args: ["run", "dev"] },
]

const children = new Map()

for (const app of apps) {
  const child = spawn(app.cmd, app.args, {
    cwd: app.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  })
  children.set(app.name, child)

  const prefix = (stream) =>
    stream.on("data", (buf) =>
      buf
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((line) => console.log(`[${app.name}] ${line}`)),
    )
  prefix(child.stdout)
  prefix(child.stderr)

  child.on("exit", (code, signal) => {
    console.log(`[${app.name}] exited (${signal ?? code})`)
  })
}

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal)
  }
  setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL")
  }, 3000).unref()
  process.exit(0)
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal))
}