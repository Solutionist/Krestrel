import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { resolveWindowsCommand } from "./resolve-command";

const tempRoot = mkdtempSync(join(tmpdir(), "krestrel-resolve-"));
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tempRoot, "d-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

const EXE_REL = "node_modules/@anthropic-ai/claude-code/bin/claude.exe";
// npm's cmd-shim for @anthropic-ai/claude-code 2.x (bin: bin/claude.exe), verbatim.
const NPM_SHIM =
  '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';

describe("resolveWindowsCommand", () => {
  it("follows npm's claude.cmd shim to claude.exe; the first PATH dir wins, the sh script is skipped", () => {
    const npm = dir({ claude: "#!/bin/sh\n", "claude.cmd": NPM_SHIM, [EXE_REL]: "" });
    const later = dir({ "claude.exe": "" });
    expect(resolveWindowsCommand("claude", `${npm};;${later}`)).toEqual({
      command: join(npm, EXE_REL),
      args: [],
    });
  });

  it("prefers claude.exe over claude.cmd in the same directory", () => {
    const both = dir({ "claude.exe": "", "claude.cmd": NPM_SHIM });
    expect(resolveWindowsCommand("claude", both)).toEqual({
      command: join(both, "claude.exe"),
      args: [],
    });
  });

  it("runs a shim's JavaScript target with this Node", () => {
    const shim =
      '@IF EXIST "%dp0%\\node.exe" (SET "_prog=%dp0%\\node.exe") ELSE (SET "_prog=node")\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
    const npm = dir({
      "claude.cmd": shim,
      "node_modules/@anthropic-ai/claude-code/cli.js": "",
    });
    expect(resolveWindowsCommand("claude", npm)).toEqual({
      command: process.execPath,
      args: [join(npm, "node_modules/@anthropic-ai/claude-code/cli.js")],
    });
  });

  it("refuses a launcher it can't run without a shell, pointing at CLAUDE_CLI_PATH", () => {
    const odd = dir({ "claude.cmd": "@echo off\r\nsomething-else %*\r\n" });
    expect(() => resolveWindowsCommand("claude", odd)).toThrow(/CLAUDE_CLI_PATH/);
  });

  it("throws ENOENT when nothing on PATH matches, never falling back to the bare name", () => {
    let caught: unknown;
    try {
      resolveWindowsCommand("claude", dir({}));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect((caught as Error).message).toBe("claude wasn't found on PATH");
  });
});
