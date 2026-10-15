// Windows can't spawn npm's `claude.cmd` shim without a shell (Node rejects .cmd/.bat with EINVAL,
// and libuv's PATH search only tries .com/.exe). A shell isn't safe here: argv carries a JSON
// schema and a multi-line system prompt that cmd.exe can't quote. So resolve to the real target.
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";

export interface ResolvedCommand {
  command: string;
  args: string[];
}

const SUFFIXES = [".exe", ".cmd", ".bat"];
const SCRIPT_EXTS: Record<string, true> = { ".js": true, ".cjs": true, ".mjs": true };
/** cmd-shim's quoted target, e.g. `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"`. */
const SHIM_TARGET = /"%dp0%\\([^"]+)"/gi;

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function runnable(path: string): ResolvedCommand | null {
  const ext = extname(path).toLowerCase();
  if (SCRIPT_EXTS[ext]) return { command: process.execPath, args: [path] };
  if (ext === ".cmd" || ext === ".bat") return null;
  return { command: path, args: [] };
}

function candidates(command: string, pathEnv: string | undefined): string[] {
  const bases = /[\\/]/.test(command)
    ? [command]
    : (pathEnv ?? "")
        .split(";")
        .filter(Boolean)
        .map((dir) => join(dir, command));
  // An extensionless name never matches as-is: that skips npm's sh script `claude`.
  return extname(command) ? bases : bases.flatMap((base) => SUFFIXES.map((s) => base + s));
}

/** Windows only: turns CLAUDE_CLI_PATH into something `spawn` can run without a shell. */
export function resolveWindowsCommand(
  command: string,
  pathEnv: string | undefined,
): ResolvedCommand {
  const found = candidates(command, pathEnv).find(isFile);
  if (found === undefined) return { command, args: [] };
  const direct = runnable(found);
  if (direct) return direct;

  const rel = [...readFileSync(found, "utf8").matchAll(SHIM_TARGET)].at(-1)?.[1];
  if (rel !== undefined) {
    const target = join(dirname(found), rel.replaceAll("\\", "/"));
    const ext = extname(target).toLowerCase();
    if (isFile(target) && (ext === ".exe" || SCRIPT_EXTS[ext])) {
      const resolved = runnable(target);
      if (resolved) return resolved;
    }
  }
  throw new Error(
    `Can't run the launcher "${found}" directly. Set CLAUDE_CLI_PATH to the full path of claude.exe.`,
  );
}
