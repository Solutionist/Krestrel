#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: echoes what it received as structured output, so tests
// can assert on the real spawn path (args, stdin, env, cwd) without calling Anthropic.
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: false,
      result: "",
      modelUsage: { "claude-test-model": {} },
      structured_output: {
        args: process.argv.slice(2),
        stdin,
        cwd: process.cwd(),
        envKeys: Object.keys(process.env).sort(),
      },
    }),
  );
});
