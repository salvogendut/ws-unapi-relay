"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");

const executable = path.resolve(__dirname, "..", "bin", "1983-msx-unapi-relay.js");

function cleanEnvironment(overrides = {}) {
  const environment = { PATH: process.env.PATH };
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("UNAPI_")) environment[key] = value;
  }
  return { ...environment, ...overrides };
}

test("CLI rejects invalid configuration with an actionable error", () => {
  const result = spawnSync(process.execPath, [executable], {
    encoding: "utf8",
    env: cleanEnvironment({ UNAPI_RELAY_PORT: "invalid" }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNAPI_RELAY_PORT/);
});

test("CLI starts and shuts down cleanly on SIGTERM", async () => {
  const child = spawn(process.execPath, [executable, "--port", "0"], {
    env: cleanEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let stopRequested = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    stdout += chunk;
    if (!stopRequested && stdout.includes("listening on ws://")) {
      stopRequested = true;
      child.kill("SIGTERM");
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk; });

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("relay CLI did not stop in time"));
    }, 5000);
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  assert.deepEqual(result, { code: 0, signal: null });
  assert.match(stdout, /listening on ws:\/\//);
  assert.match(stdout, /Stopping on SIGTERM/);
  assert.equal(stderr, "");
});
