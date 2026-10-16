#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: echoes what it received as structured output, so tests
// can assert on the real spawn path (args, stdin, env, cwd) without calling Anthropic.
// A prompt containing FAKE_HANG never answers, so tests can stop a run that is still going.
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  if (stdin.includes("FAKE_HANG")) {
    setInterval(() => {}, 1_000);
    return;
  }
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
