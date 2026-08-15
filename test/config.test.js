"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const {
  loadConfig,
  parseBoolean,
  parsePortSet,
} = require("../src/config.js");
const { parseArguments, publicConfig } = require("../bin/ws-unapi-relay.js");

const temporaryDirectories = [];

after(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

test("configuration has conservative standalone defaults", () => {
  const config = loadConfig({}, {});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9380);
  assert.equal(config.path, "/unapi");
  assert.equal(config.allowPrivate, false);
  assert.equal(config.allowMissingOrigin, false);
  assert.deepEqual([...config.tcpPorts], [23, 70, 80, 443, 2323]);
  assert.deepEqual([...config.udpPorts], [123]);
});

test("environment settings are parsed and validated", () => {
  const config = loadConfig({}, {
    UNAPI_RELAY_HOST: "0.0.0.0",
    UNAPI_RELAY_PORT: "8083",
    UNAPI_ORIGINS: "https://emulator.example/, https://client.example",
    UNAPI_ALLOW_PRIVATE: "yes",
    UNAPI_TCP_PORTS: "70,80",
    UNAPI_UDP_PORTS: "",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8083);
  assert.deepEqual([...config.origins], [
    "https://emulator.example",
    "https://client.example",
  ]);
  assert.equal(config.allowPrivate, true);
  assert.deepEqual([...config.tcpPorts], [70, 80]);
  assert.deepEqual([...config.udpPorts], []);
});

test("token files avoid exposing secrets in service command lines", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ws-relay-test-"));
  temporaryDirectories.push(directory);
  const filename = path.join(directory, "token");
  fs.writeFileSync(filename, "secret-token\n", { mode: 0o600 });
  const config = loadConfig({}, { UNAPI_TOKEN_FILE: filename });
  assert.equal(config.token, "secret-token");
  assert.equal(publicConfig(config).token, "(configured)");
});

test("invalid settings fail before the listener starts", () => {
  assert.throws(() => loadConfig({}, { UNAPI_RELAY_PORT: "not-a-port" }),
                /UNAPI_RELAY_PORT/);
  assert.throws(() => loadConfig({}, { UNAPI_RELAY_PORT: "" }),
                /UNAPI_RELAY_PORT/);
  assert.throws(() => loadConfig({}, { UNAPI_RELAY_HOST: "" }),
                /UNAPI_RELAY_HOST/);
  assert.throws(() => loadConfig({}, { UNAPI_RELAY_PATH: "relative" }),
                /absolute URL path/);
  assert.throws(() => loadConfig({}, { UNAPI_ORIGINS: "file:///tmp/emulator" }),
                /UNAPI_ORIGINS/);
  assert.throws(() => loadConfig({}, {
    UNAPI_TOKEN: "one",
    UNAPI_TOKEN_FILE: "/tmp/two",
  }), /only one/);
  assert.throws(() => parsePortSet("80,70000", []), /port/);
  assert.throws(() => parseBoolean("perhaps", "TEST"), /TEST/);
});

test("command line options override environment-backed configuration", () => {
  const parsed = parseArguments([
    "--host", "0.0.0.0",
    "--port", "8083",
    "--origins", "https://emulator.example",
    "--allow-private",
    "--check-config",
  ]);
  assert.equal(parsed.action, "check");
  const config = loadConfig(parsed.options, { UNAPI_RELAY_PORT: "9999" });
  assert.equal(config.port, 8083);
  assert.equal(config.allowPrivate, true);
  assert.deepEqual([...config.origins], ["https://emulator.example"]);
  assert.throws(() => parseArguments(["--unknown"]), /unknown option/);
});
