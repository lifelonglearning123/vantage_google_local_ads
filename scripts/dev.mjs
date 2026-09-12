import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Starts `next dev` with a larger request-header limit.
//
// Browsers send every localhost cookie to every localhost port, so logins from other local apps
// (a Supabase session cookie is about 3 KB) ride along on every request here. Past Node's default
// 16 KB of headers, Node answers "431 Request Header Fields Too Large" before the app runs. Pages
// still load, but a Save — which carries a few more headers than a page view — "didn't go through",
// with nothing in the server log. Vercel doesn't have the problem: the app has its own domain there.
const HEADER_LIMIT = "--max-http-header-size=65536";

const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, HEADER_LIMIT].filter(Boolean).join(" "),
};

const child = spawn(process.execPath, [next, "dev", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
