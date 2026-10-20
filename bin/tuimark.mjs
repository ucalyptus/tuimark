#!/usr/bin/env node
// Validates arguments in the plain terminal, then hands off to the pixel runtime.
// The app receives `<absolute path> <view>` as process.argv[2..3] (see src/main.tsx).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWS = ["split", "edit", "preview"];
const { version } = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
const OMP_EXTENSION = path.join(os.homedir(), ".omp", "agent", "extensions", "tuimark.ts");

const HELP = `tuimark ${version} — markdown editor and live preview for graphics terminals

usage: tuimark [path] [--view split|edit|preview]
       tuimark install-omp | uninstall-omp

  path            markdown file to open (created on first save), or a directory
                  to browse; defaults to the current directory
  --view, -v      starting layout (default: split)
  -p, --preview   shorthand for --view preview
  -e, --edit      shorthand for --view edit
  -h, --help      show this help
  --version       print the version

  install-omp     install the omp extension (/tuimark command, tuimark_open tool)
                  into ${OMP_EXTENSION.replace(os.homedir(), "~")}; restart omp after
  uninstall-omp   remove that extension

keys: ^S save · ^E cycle view · ^T file list · ^R reload from disk · ^Q quit
      preview view: j/k/space/g/G scroll, e edit, q quit
`;

function fail(message) {
  process.stderr.write(`tuimark: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] === "install-omp") {
  fs.mkdirSync(path.dirname(OMP_EXTENSION), { recursive: true });
  fs.copyFileSync(path.join(APP_DIR, "omp", "tuimark.ts"), OMP_EXTENSION);
  process.stdout.write(`installed ${OMP_EXTENSION}\nrestart omp to load /tuimark and the tuimark_open tool\n`);
  process.exit(0);
}
if (args[0] === "uninstall-omp") {
  const existed = fs.existsSync(OMP_EXTENSION);
  fs.rmSync(OMP_EXTENSION, { force: true });
  process.stdout.write(existed ? `removed ${OMP_EXTENSION}\n` : `${OMP_EXTENSION} was not installed\n`);
  process.exit(0);
}
let view = "split";
let target;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-h" || arg === "--help") {
    process.stdout.write(HELP);
    process.exit(0);
  } else if (arg === "--version") {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  } else if (arg === "-p" || arg === "--preview") {
    view = "preview";
  } else if (arg === "-e" || arg === "--edit") {
    view = "edit";
  } else if (arg === "-v" || arg === "--view" || arg.startsWith("--view=")) {
    view = arg.startsWith("--view=") ? arg.slice("--view=".length) : args[++i];
    if (!VIEWS.includes(view)) fail(`--view must be one of ${VIEWS.join(", ")}`);
  } else if (arg === "--") {
    if (i + 1 < args.length) target = args[++i];
  } else if (arg.startsWith("-") && arg !== "-") {
    fail(`unknown option ${arg} (see tuimark --help)`);
  } else if (target === undefined) {
    target = arg;
  } else {
    fail(`unexpected argument ${arg}; tuimark opens one path`);
  }
}

const resolved = path.resolve(target ?? ".");
if (!fs.existsSync(resolved) && !fs.existsSync(path.dirname(resolved))) {
  fail(`${path.dirname(resolved)} does not exist`);
}

const entry = path.join(APP_DIR, "dist", "main.js");
if (!fs.existsSync(entry)) fail(`${entry} is missing; run \`npm run build\` in ${APP_DIR}`);

const pixel = path.join(APP_DIR, "node_modules", "@zenbu-labs", "pixel", "dist", "bin.js");
if (!fs.existsSync(pixel)) fail(`pixel runtime missing; run \`npm install\` in ${APP_DIR}`);

const child = spawn(process.execPath, [pixel, APP_DIR, "--", resolved, view], { stdio: "inherit" });
// pixel forwards signals to its runtime; keep this process alive until it exits.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => {});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
