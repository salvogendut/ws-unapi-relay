"use strict";

const crypto = require("node:crypto");
const dgram = require("node:dgram");
const dns = require("node:dns").promises;
const http = require("node:http");
const net = require("node:net");
const { WebSocketServer } = require("ws");
const { loadConfig } = require("./config.js");
const P = require("./protocol.js");

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  } catch (_) {
    return false;
  }
}

function tokenMatches(expected, actual) {
  if (!expected) return true;
  if (!actual) return false;
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(actual));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function ipv4Parts(address) {
  if (!net.isIPv4(address)) return null;
  return address.split(".").map(Number);
}

function isPublicIPv4(address) {
  const p = ipv4Parts(address);
  if (!p) return false;
  if (p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224) return false;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
  if (p[0] === 169 && p[1] === 254) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  if (p[0] === 192 && p[1] === 168) return false;
  if (p[0] === 192 && p[1] === 0 && p[2] === 0) return false;
  if (p[0] === 192 && p[1] === 0 && p[2] === 2) return false;
  if (p[0] === 192 && p[1] === 88 && p[2] === 99) return false;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return false;
  if (p[0] === 198 && p[1] === 51 && p[2] === 100) return false;
  if (p[0] === 203 && p[1] === 0 && p[2] === 113) return false;
  return true;
}

function ipv4Bytes(address) {
  const parts = ipv4Parts(address);
  if (!parts) throw new Error("not an IPv4 address");
  return new Uint8Array(parts);
}

function payloadIPv4(payload, offset = 0) {
  return [payload[offset], payload[offset + 1], payload[offset + 2],
          payload[offset + 3]].join(".");
}

function createRelayServer(options = {}) {
  const config = loadConfig(options);
  const startedAt = Date.now();

  function addressAllowed(address) {
    return config.allowPrivate ? Boolean(ipv4Parts(address)) : isPublicIPv4(address);
  }

  async function resolveAddress(hostname) {
    if (net.isIPv4(hostname)) {
      if (!addressAllowed(hostname)) throw new Error("destination address is denied");
      return hostname;
    }
    if (!hostname || hostname.length > 253 || hostname.includes("\0"))
      throw new Error("invalid hostname");
    const answers = await dns.lookup(hostname, { family: 4, all: true, verbatim: true });
    const answer = answers.find(item => addressAllowed(item.address));
    if (!answer) throw new Error("hostname has no permitted IPv4 address");
    return answer.address;
  }

  function handleHttp(request, response) {
    let url;
    try {
      url = new URL(request.url, "http://relay.invalid");
    } catch (_) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Bad request\n");
      return;
    }
    if (url.pathname === "/healthz" &&
        (request.method === "GET" || request.method === "HEAD")) {
      const body = JSON.stringify({
        service: "ws-unapi-relay",
        status: "ok",
        clients: wss.clients.size,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }

  const server = http.createServer((request, response) => {
    handleHttp(request, response);
  });

  const wss = new WebSocketServer({
    server,
    path: config.path,
    maxPayload: config.maxPayload,
    perMessageDeflate: false,
    verifyClient(info, done) {
      const origin = info.origin || "";
      const allowedOrigin = config.origins.size
        ? config.origins.has(origin)
        : isLoopbackOrigin(origin);
      const missingAllowed = !origin && config.allowMissingOrigin;
      let suppliedToken = "";
      try {
        suppliedToken = new URL(info.req.url, "http://relay.invalid")
          .searchParams.get("token") || "";
      } catch (_) {}
      if ((!allowedOrigin && !missingAllowed) ||
          !tokenMatches(config.token, suppliedToken) ||
          wss.clients.size >= config.maxClients) {
        done(false, 403, "Forbidden");
        return;
      }
      done(true);
    },
  });
  /* ws mirrors underlying HTTP-listener errors onto the WebSocketServer. The
   * listen() promise below owns and reports those errors to the caller. */
  wss.on("error", () => {});

  function send(ws, type, channel = 0, request = 0, payload = new Uint8Array()) {
    if (ws.readyState !== 1 || ws.bufferedAmount > config.maxBufferedAmount)
      return false;
    try {
      ws.send(P.encode(type, channel, request, payload));
      return true;
    } catch (_) {
      return false;
    }
  }

  function sendResult(ws, type, frame, status, extra = new Uint8Array()) {
    return send(ws, type, frame.channel, frame.request,
                P.concat(new Uint8Array([status]), extra));
  }

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();

  wss.on("connection", ws => {
    const channels = new Map();
    let greeted = false;
    let pendingDns = 0;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    const helloTimer = setTimeout(() => {
      if (!greeted) ws.close(1002, "HELLO timeout");
    }, config.handshakeTimeoutMs);
    helloTimer.unref();

    function channelKey(kind, channel) { return kind + ":" + channel; }

    function removeChannel(channel, state) {
      const key = channelKey(state.kind, channel);
      if (channels.get(key) === state) channels.delete(key);
    }

    function closeState(channel, state, report = false) {
      removeChannel(channel, state);
      state.suppressClose = true;
      if (report && state.kind === "tcp") {
        if (!state.ready && !state.openResultSent) {
          sendResult(ws, P.Type.TCP_OPEN_RESULT, state.openFrame,
                     P.Status.IO_ERROR);
          state.openResultSent = true;
        } else if (state.ready && !state.closeSent) {
          send(ws, P.Type.TCP_CLOSED, channel, 0,
               new Uint8Array([P.Status.IO_ERROR]));
          state.closeSent = true;
        }
      } else if (report && state.kind === "udp") {
        if (!state.ready && !state.openResultSent) {
          sendResult(ws, P.Type.UDP_OPEN_RESULT, state.openFrame,
                     P.Status.IO_ERROR);
          state.openResultSent = true;
        } else if (state.ready) {
          send(ws, P.Type.UDP_CLOSED, channel, 0,
               new Uint8Array([P.Status.IO_ERROR]));
        }
      }
      if (state.kind === "tcp") {
        if (state.socket) state.socket.destroy();
      } else {
        try { state.socket.close(); } catch (_) {}
      }
    }

    async function handleDns(frame) {
      if (pendingDns >= config.maxDnsRequests) {
        sendResult(ws, P.Type.DNS_RESULT, frame, P.Status.BUSY);
        return;
      }
      pendingDns++;
      let host;
      try {
        host = P.decodeText(frame.payload);
        const address = await resolveAddress(host);
        sendResult(ws, P.Type.DNS_RESULT, frame, P.Status.OK, ipv4Bytes(address));
      } catch (_) {
        sendResult(ws, P.Type.DNS_RESULT, frame, P.Status.CONNECT_FAILED);
      } finally {
        pendingDns--;
      }
    }

    async function handleTcpOpen(frame) {
      if (frame.channel < 1 || frame.channel > config.maxChannels) {
        sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.BAD_CHANNEL);
        return;
      }
      const key = channelKey("tcp", frame.channel);
      if (channels.has(key)) {
        sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.NO_SLOT);
        return;
      }
      if (frame.payload.length < 4) {
        sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.BAD_LENGTH);
        return;
      }
      const flags = frame.payload[0];
      const port = P.readU16(frame.payload, 1);
      const host = P.decodeText(frame.payload.subarray(3));
      if (!config.tcpPorts.has(port) || !host) {
        sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.BAD_ARGUMENT);
        return;
      }

      const state = { kind: "tcp", channel: frame.channel,
                      socket: null, ready: false, openFrame: frame,
                      suppressClose: false, lastActivity: Date.now() };
      channels.set(key, state);
      try {
        const address = await resolveAddress(host);
        if (channels.get(key) !== state || ws.readyState !== 1) return;
        const socket = net.createConnection({ host: address, port, family: 4 });
        state.socket = socket;
        if (flags & 0x01) socket.setNoDelay(true);
        socket.setTimeout(config.connectTimeoutMs, () => socket.destroy(new Error("timeout")));
        socket.on("data", data => {
          state.lastActivity = Date.now();
          for (let offset = 0; offset < data.length; offset += config.maxDataChunk) {
            const chunk = data.subarray(offset, offset + config.maxDataChunk);
            if (!send(ws, P.Type.TCP_DATA, frame.channel, 0, chunk)) {
              socket.destroy(new Error("relay backpressure"));
              break;
            }
          }
        });
        socket.on("error", () => {
          if (!state.ready) {
            sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.CONNECT_FAILED);
            state.openResultSent = true;
          } else if (!state.suppressClose) {
            send(ws, P.Type.TCP_CLOSED, frame.channel, 0,
                 new Uint8Array([P.Status.IO_ERROR]));
            state.closeSent = true;
          }
        });
        socket.on("close", () => {
          removeChannel(frame.channel, state);
          if (state.ready && !state.suppressClose && !state.closeSent)
            send(ws, P.Type.TCP_CLOSED, frame.channel, 0,
                 new Uint8Array([P.Status.OK]));
          if (!state.ready && !state.openResultSent)
            sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.CONNECT_FAILED);
        });
        socket.once("connect", () => {
          socket.setTimeout(0);
          if (channels.get(key) !== state) return socket.destroy();
          state.ready = true;
          state.lastActivity = Date.now();
          const localAddress = net.isIPv4(socket.localAddress)
            ? socket.localAddress : "0.0.0.0";
          sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.OK,
                     P.concat(ipv4Bytes(localAddress), P.u16(socket.localPort || 0)));
        });
      } catch (_) {
        removeChannel(frame.channel, state);
        sendResult(ws, P.Type.TCP_OPEN_RESULT, frame, P.Status.CONNECT_FAILED);
      }
    }

    function handleTcpSend(frame) {
      const state = channels.get(channelKey("tcp", frame.channel));
      if (!state || state.kind !== "tcp" || !state.ready) return;
      state.lastActivity = Date.now();
      if (state.socket.writableLength + frame.payload.length > config.maxSocketBuffer)
        return closeState(frame.channel, state, true);
      state.socket.write(frame.payload);
    }

    function handleTcpClose(frame) {
      const state = channels.get(channelKey("tcp", frame.channel));
      if (state && state.kind === "tcp") closeState(frame.channel, state, false);
    }

    function handleUdpOpen(frame) {
      if (frame.channel < 1 || frame.channel > config.maxChannels) {
        sendResult(ws, P.Type.UDP_OPEN_RESULT, frame, P.Status.BAD_CHANNEL);
        return;
      }
      const key = channelKey("udp", frame.channel);
      if (channels.has(key)) {
        sendResult(ws, P.Type.UDP_OPEN_RESULT, frame, P.Status.NO_SLOT);
        return;
      }
      if (frame.payload.length !== 2) {
        sendResult(ws, P.Type.UDP_OPEN_RESULT, frame, P.Status.BAD_LENGTH);
        return;
      }
      const localPort = P.readU16(frame.payload);
      if (localPort !== 0) {
        sendResult(ws, P.Type.UDP_OPEN_RESULT, frame, P.Status.BAD_ARGUMENT);
        return;
      }
      const socket = dgram.createSocket("udp4");
      const state = { kind: "udp", channel: frame.channel,
                      socket, ready: false, openFrame: frame,
                      peers: new Set(),
                      suppressClose: false, lastActivity: Date.now() };
      channels.set(key, state);
      socket.on("message", (data, remote) => {
        state.lastActivity = Date.now();
        const peer = `${remote.address}:${remote.port}`;
        if (!state.peers.has(peer) || !addressAllowed(remote.address) ||
            data.length > config.maxDatagram) return;
        if (!send(ws, P.Type.UDP_DATA, frame.channel, 0,
                  P.concat(ipv4Bytes(remote.address), P.u16(remote.port), data)))
          closeState(frame.channel, state, true);
      });
      socket.on("error", () => {
        if (!state.ready) {
          sendResult(ws, P.Type.UDP_OPEN_RESULT, frame, P.Status.IO_ERROR);
          state.openResultSent = true;
        } else if (!state.suppressClose) {
          send(ws, P.Type.UDP_CLOSED, frame.channel, 0,
               new Uint8Array([P.Status.IO_ERROR]));
        }
        removeChannel(frame.channel, state);
        try { socket.close(); } catch (_) {}
      });
      socket.on("close", () => removeChannel(frame.channel, state));
      socket.bind({ address: "0.0.0.0", port: localPort, exclusive: true }, () => {
        if (channels.get(key) !== state) return socket.close();
        state.ready = true;
        state.lastActivity = Date.now();
        sendResult(ws, P.Type.UDP_OPEN_RESULT, frame, P.Status.OK,
                   P.u16(socket.address().port));
      });
    }

    function handleUdpSend(frame) {
      const state = channels.get(channelKey("udp", frame.channel));
      if (!state || state.kind !== "udp" || !state.ready || frame.payload.length < 6)
        return;
      if (frame.payload.length - 6 > config.maxDatagram)
        return closeState(frame.channel, state, true);
      const address = payloadIPv4(frame.payload);
      const port = P.readU16(frame.payload, 4);
      if (!addressAllowed(address) || !config.udpPorts.has(port))
        return closeState(frame.channel, state, true);
      const peer = `${address}:${port}`;
      if (!state.peers.has(peer) && state.peers.size >= config.maxUdpPeers)
        return closeState(frame.channel, state, true);
      state.peers.add(peer);
      state.lastActivity = Date.now();
      state.socket.send(frame.payload.subarray(6), port, address, error => {
        if (error && channels.get(channelKey("udp", frame.channel)) === state)
          closeState(frame.channel, state, true);
      });
    }

    function handleUdpClose(frame) {
      const state = channels.get(channelKey("udp", frame.channel));
      if (state && state.kind === "udp") closeState(frame.channel, state, false);
    }

    ws.on("message", (data, isBinary) => {
      if (!isBinary) return ws.close(1003, "binary frames required");
      let frame;
      try {
        frame = P.decode(data);
      } catch (_) {
        return ws.close(1002, "invalid relay frame");
      }
      if (!greeted) {
        if (frame.type !== P.Type.HELLO) return ws.close(1002, "HELLO required");
        greeted = true;
        clearTimeout(helloTimer);
        send(ws, P.Type.READY, 0, frame.request,
             P.u32(P.Feature.DNS | P.Feature.TCP | P.Feature.UDP));
        return;
      }
      switch (frame.type) {
        case P.Type.DNS: void handleDns(frame); break;
        case P.Type.TCP_OPEN: void handleTcpOpen(frame); break;
        case P.Type.TCP_SEND: handleTcpSend(frame); break;
        case P.Type.TCP_CLOSE: handleTcpClose(frame); break;
        case P.Type.UDP_OPEN: handleUdpOpen(frame); break;
        case P.Type.UDP_SEND: handleUdpSend(frame); break;
        case P.Type.UDP_CLOSE: handleUdpClose(frame); break;
        default: ws.close(1002, "unknown relay operation"); break;
      }
    });

    const idleSweep = setInterval(() => {
      const cutoff = Date.now() - config.idleTimeoutMs;
      for (const state of channels.values()) {
        if (state.lastActivity < cutoff)
          closeState(state.channel, state, true);
      }
    }, Math.min(30000, Math.max(1000, config.idleTimeoutMs / 2)));
    idleSweep.unref();

    ws.on("close", () => {
      clearTimeout(helloTimer);
      clearInterval(idleSweep);
      for (const state of channels.values())
        closeState(state.channel, state, false);
      channels.clear();
    });
  });

  return {
    config,
    server,
    wss,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      return new Promise(resolve => {
        const closeHttp = () => {
          if (!server.listening) return resolve();
          server.close(resolve);
        };
        wss.close(closeHttp);
      });
    },
  };
}

module.exports = {
  createRelayServer,
  isPublicIPv4,
};
