"use strict";

const fs = require("node:fs");

const DEFAULT_TCP_PORTS = Object.freeze([23, 70, 80, 443, 2323]);
const DEFAULT_UDP_PORTS = Object.freeze([123]);

function valueFor(overrides, key, env, envName, fallback) {
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
  if (Object.prototype.hasOwnProperty.call(env, envName)) return env[envName];
  return fallback;
}

function parseBoolean(value, name, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false`);
}

function parseInteger(value, name, { min, max }) {
  if (typeof value === "string" && value.trim() === "")
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return number;
}

function parsePortSet(value, fallback) {
  if (value instanceof Set) value = [...value];
  const source = value === undefined || value === null
    ? fallback
    : Array.isArray(value) ? value : String(value).split(",");
  const ports = new Set();
  for (const item of source) {
    if (String(item).trim() === "") continue;
    ports.add(parseInteger(item, "port", { min: 1, max: 65535 }));
  }
  return ports;
}

function parseOrigins(value) {
  if (value === undefined || value === null || String(value).trim() === "")
    return new Set();
  const source = value instanceof Set ? [...value] :
    Array.isArray(value) ? value : String(value).split(",");
  const origins = new Set();
  for (const item of source) {
    const candidate = String(item).trim();
    if (!candidate) continue;
    let url;
    try {
      url = new URL(candidate);
    } catch (_) {
      throw new Error(`invalid UNAPI_ORIGINS entry: ${candidate}`);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username || url.password || url.pathname !== "/" ||
        url.search || url.hash)
      throw new Error(`invalid UNAPI_ORIGINS entry: ${candidate}`);
    origins.add(url.origin);
  }
  return origins;
}

function readToken(token, tokenFile) {
  if (token && tokenFile)
    throw new Error("set only one of UNAPI_TOKEN and UNAPI_TOKEN_FILE");
  if (!tokenFile) return token || "";
  try {
    return fs.readFileSync(tokenFile, "utf8").trim();
  } catch (error) {
    throw new Error(`cannot read UNAPI_TOKEN_FILE: ${error.message}`);
  }
}

function loadConfig(overrides = {}, env = process.env) {
  const get = (key, envName, fallback) =>
    valueFor(overrides, key, env, envName, fallback);
  const token = get("token", "UNAPI_TOKEN", "");
  const tokenFile = get("tokenFile", "UNAPI_TOKEN_FILE", "");
  const host = String(get("host", "UNAPI_RELAY_HOST", "127.0.0.1")).trim();
  if (!host || /\s/.test(host))
    throw new Error("UNAPI_RELAY_HOST must be a non-empty address or hostname");
  const path = String(get("path", "UNAPI_RELAY_PATH", "/unapi"));
  if (!path.startsWith("/") || path.includes("?") || path.includes("#") ||
      /[\u0000-\u0020]/.test(path))
    throw new Error("UNAPI_RELAY_PATH must be an absolute URL path");

  return {
    host,
    port: parseInteger(get("port", "UNAPI_RELAY_PORT", 9380),
                       "UNAPI_RELAY_PORT", { min: 0, max: 65535 }),
    path,
    origins: parseOrigins(get("origins", "UNAPI_ORIGINS", undefined)),
    token: readToken(String(token || ""), String(tokenFile || "")),
    allowMissingOrigin: parseBoolean(
      get("allowMissingOrigin", "UNAPI_ALLOW_MISSING_ORIGIN", false),
      "UNAPI_ALLOW_MISSING_ORIGIN"
    ),
    allowPrivate: parseBoolean(
      get("allowPrivate", "UNAPI_ALLOW_PRIVATE", false),
      "UNAPI_ALLOW_PRIVATE"
    ),
    tcpPorts: parsePortSet(
      get("tcpPorts", "UNAPI_TCP_PORTS", undefined), DEFAULT_TCP_PORTS
    ),
    udpPorts: parsePortSet(
      get("udpPorts", "UNAPI_UDP_PORTS", undefined), DEFAULT_UDP_PORTS
    ),
    maxClients: parseInteger(
      get("maxClients", "UNAPI_MAX_CLIENTS", 16),
      "UNAPI_MAX_CLIENTS", { min: 1, max: 1024 }
    ),
    maxChannels: parseInteger(
      get("maxChannels", "UNAPI_MAX_CHANNELS", 4),
      "UNAPI_MAX_CHANNELS", { min: 1, max: 4 }
    ),
    maxPayload: parseInteger(
      get("maxPayload", "UNAPI_MAX_PAYLOAD", 65536),
      "UNAPI_MAX_PAYLOAD", { min: 8, max: 1048576 }
    ),
    maxBufferedAmount: parseInteger(
      get("maxBufferedAmount", "UNAPI_MAX_BUFFERED_AMOUNT", 262144),
      "UNAPI_MAX_BUFFERED_AMOUNT", { min: 1024, max: 16777216 }
    ),
    maxSocketBuffer: parseInteger(
      get("maxSocketBuffer", "UNAPI_MAX_SOCKET_BUFFER", 262144),
      "UNAPI_MAX_SOCKET_BUFFER", { min: 1024, max: 16777216 }
    ),
    maxDataChunk: parseInteger(
      get("maxDataChunk", "UNAPI_MAX_DATA_CHUNK", 16384),
      "UNAPI_MAX_DATA_CHUNK", { min: 1, max: 65535 }
    ),
    maxDatagram: parseInteger(
      get("maxDatagram", "UNAPI_MAX_DATAGRAM", 8192),
      "UNAPI_MAX_DATAGRAM", { min: 1, max: 65507 }
    ),
    maxDnsRequests: parseInteger(
      get("maxDnsRequests", "UNAPI_MAX_DNS_REQUESTS", 4),
      "UNAPI_MAX_DNS_REQUESTS", { min: 1, max: 256 }
    ),
    maxUdpPeers: parseInteger(
      get("maxUdpPeers", "UNAPI_MAX_UDP_PEERS", 16),
      "UNAPI_MAX_UDP_PEERS", { min: 1, max: 1024 }
    ),
    connectTimeoutMs: parseInteger(
      get("connectTimeoutMs", "UNAPI_CONNECT_TIMEOUT_MS", 10000),
      "UNAPI_CONNECT_TIMEOUT_MS", { min: 100, max: 300000 }
    ),
    handshakeTimeoutMs: parseInteger(
      get("handshakeTimeoutMs", "UNAPI_HANDSHAKE_TIMEOUT_MS", 10000),
      "UNAPI_HANDSHAKE_TIMEOUT_MS", { min: 100, max: 300000 }
    ),
    heartbeatMs: parseInteger(
      get("heartbeatMs", "UNAPI_HEARTBEAT_MS", 30000),
      "UNAPI_HEARTBEAT_MS", { min: 1000, max: 300000 }
    ),
    idleTimeoutMs: parseInteger(
      get("idleTimeoutMs", "UNAPI_IDLE_TIMEOUT_MS", 120000),
      "UNAPI_IDLE_TIMEOUT_MS", { min: 1000, max: 86400000 }
    ),
  };
}

module.exports = {
  DEFAULT_TCP_PORTS,
  DEFAULT_UDP_PORTS,
  loadConfig,
  parseBoolean,
  parseInteger,
  parseOrigins,
  parsePortSet,
};
