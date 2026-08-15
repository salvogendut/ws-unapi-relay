"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const packageInfo = require("../package.json");
const lockInfo = require("../package-lock.json");
const spec = fs.readFileSync(path.join(root, "ws-unapi-relay.spec"), "utf8");
const unit = fs.readFileSync(
  path.join(root, "packaging/systemd/ws-unapi-relay.service"), "utf8"
);

test("RPM versions follow package.json and its dependency lock", () => {
  const version = spec.match(/^Version:\s*(\S+)/m);
  const wsVersion = spec.match(/^%global ws_version\s+(\S+)/m);
  assert.ok(version);
  assert.ok(wsVersion);
  assert.equal(version[1], packageInfo.version);
  assert.equal(wsVersion[1], lockInfo.packages["node_modules/ws"].version);
  assert.match(spec, /^Provides:\s+1983-msx-unapi-relay\s+=/m);
  assert.match(spec, /^Obsoletes:\s+1983-msx-unapi-relay\s+</m);
  assert.match(spec, /Provides:\s+bundled\(nodejs-ws\)/);
});

test("RPM owns a complete systemd lifecycle", () => {
  assert.match(spec, /%systemd_post %\{name\}\.service/);
  assert.match(spec, /%systemd_preun %\{name\}\.service/);
  assert.match(spec, /%systemd_postun_with_restart %\{name\}\.service/);
  assert.match(spec, /%config\(noreplace\).*_sysconfdir.*\/sysconfig\//);
  assert.match(unit, /^DynamicUser=yes$/m);
  assert.match(unit, /^EnvironmentFile=-\/etc\/sysconfig\//m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/env ws-unapi-relay$/m);
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
});
