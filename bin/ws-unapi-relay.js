#!/usr/bin/env node
"use strict";

const packageInfo = require("../package.json");
const { loadConfig } = require("../src/config.js");
const { createRelayServer } = require("../src/relay.js");

const VALUE_OPTIONS = new Map([
  ["--host", "host"],
  ["--port", "port"],
  ["--path", "path"],
  ["--origins", "origins"],
  ["--token-file", "tokenFile"],
  ["--tcp-ports", "tcpPorts"],
  ["--udp-ports", "udpPorts"],
]);

function usage() {
  return `ws-unapi-relay ${packageInfo.version}

Usage: ws-unapi-relay [options]

Options:
  --host ADDRESS           Listen address (default: 127.0.0.1)
  --port PORT              Listen port (default: 9380)
  --path PATH              WebSocket path (default: /unapi)
  --origins LIST           Comma-separated browser origins
  --token-file FILE        Read the shared token from FILE
  --tcp-ports LIST         Allowed outbound TCP ports
  --udp-ports LIST         Allowed outbound UDP ports
  --allow-private          Permit private IPv4 destinations
  --allow-missing-origin   Permit clients without an Origin header
  --check-config           Validate and print non-secret configuration
  --version                Print version
  --help                   Show this help

Every setting is also available through the UNAPI_* environment variables
documented in the manual. Command-line options take precedence.
`;
}

function parseArguments(argv) {
  const options = {};
  let checkConfig = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { action: "help" };
    if (argument === "--version" || argument === "-V") return { action: "version" };
    if (argument === "--check-config") {
      checkConfig = true;
      continue;
    }
    if (argument === "--allow-private") {
      options.allowPrivate = true;
      continue;
    }
    if (argument === "--allow-missing-origin") {
      options.allowMissingOrigin = true;
      continue;
    }
    const key = VALUE_OPTIONS.get(argument);
    if (!key) throw new Error(`unknown option: ${argument}`);
    if (index + 1 >= argv.length) throw new Error(`${argument} requires a value`);
    options[key] = argv[++index];
  }
  return { action: checkConfig ? "check" : "run", options };
}

function publicConfig(config) {
  return {
    ...config,
    origins: [...config.origins],
    tcpPorts: [...config.tcpPorts],
    udpPorts: [...config.udpPorts],
    token: config.token ? "(configured)" : "(not configured)",
  };
}

async function main(argv = process.argv.slice(2)) {
  const command = parseArguments(argv);
  if (command.action === "help") {
    process.stdout.write(usage());
    return;
  }
  if (command.action === "version") {
    process.stdout.write(`${packageInfo.version}\n`);
    return;
  }

  const config = loadConfig(command.options);
  if (command.action === "check") {
    process.stdout.write(`${JSON.stringify(publicConfig(config), null, 2)}\n`);
    return;
  }

  const relay = createRelayServer(config);
  const address = await relay.listen();
  let stopping = false;
  const stop = async signal => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`Stopping on ${signal}\n`);
    const forcedExit = setTimeout(() => process.exit(1), 10000);
    forcedExit.unref();
    await relay.close();
  };
  process.once("SIGINT", () => { void stop("SIGINT"); });
  process.once("SIGTERM", () => { void stop("SIGTERM"); });

  const printableAddress = address.family === "IPv6"
    ? `[${address.address}]` : address.address;
  process.stdout.write(
    `WebSocket UNAPI relay ${packageInfo.version} listening on ` +
    `ws://${printableAddress}:${address.port}${relay.config.path}\n`
  );
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`ws-unapi-relay: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments, publicConfig, usage };
