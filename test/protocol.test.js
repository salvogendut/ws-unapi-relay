"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const P = require("../src/protocol.js");

test("protocol publishes current and legacy browser globals", () => {
  assert.equal(globalThis.JSWsUnapiRelayProtocol, P);
  assert.equal(globalThis.JS1983UnapiProtocol, P);
});

test("protocol frames preserve request, channel, and payload", () => {
  const payload = P.concat(new Uint8Array([7]), P.u16(2323), P.encodeText("host"));
  const decoded = P.decode(P.encode(P.Type.TCP_OPEN, 3, 0x1234, payload));
  assert.equal(decoded.type, P.Type.TCP_OPEN);
  assert.equal(decoded.channel, 3);
  assert.equal(decoded.request, 0x1234);
  assert.deepEqual([...decoded.payload], [...payload]);
  assert.equal(P.readU16(decoded.payload, 1), 2323);
  assert.equal(P.decodeText(decoded.payload.subarray(3)), "host");
});

test("protocol decoder rejects malformed frames", () => {
  const encoded = P.encode(P.Type.HELLO);
  assert.throws(() => P.decode(encoded.subarray(0, encoded.length - 1)), /header/);
  const badMagic = encoded.slice();
  badMagic[0] = 0;
  assert.throws(() => P.decode(badMagic), /header/);
  const badLength = encoded.slice();
  badLength[6] = 1;
  assert.throws(() => P.decode(badLength), /length/);
  assert.throws(() => P.encode(P.Type.DNS, 0, 0, new Uint8Array(65536)),
                /too large/);
});
