# 1983 MSX UNAPI Relay

A small, restricted WebSocket-to-TCP/UDP relay for the
[1983 MSX/MSX2 emulator](https://github.com/salvogendut/1983). It gives browser
builds access to the TCP/IP UNAPI services used by software such as GEOBENCH
and SymbOS.

Browsers cannot open arbitrary TCP or UDP sockets, so the complete path is:

    MSX program -> UNAPINET.COM -> 1983 WASM bridge -> WebSocket relay -> Internet

The relay is deliberately not a general-purpose open proxy. It defaults to a
loopback listener, rejects private and reserved destinations, restricts
destination ports, checks browser origins, and limits clients, channels,
payloads, queues, and idle connections.

## Quick start

Node.js 20 or newer is required.

```sh
npm ci
UNAPI_ORIGINS=http://127.0.0.1:8000 npm start
```

The relay listens at `ws://127.0.0.1:1983/unapi`. Its health endpoint is:

```sh
curl http://127.0.0.1:1983/healthz
```

Point 1983 at the relay through its AUX panel, or use a one-load URL:

```text
http://127.0.0.1:8000/?extensions=unapi&unapiRelay=ws%3A%2F%2F127.0.0.1%3A1983%2Funapi
```

Guest software still needs the `UNAPINET.COM` driver. Enabling the host
extension alone does not install a guest TCP/IP UNAPI implementation.

## Configuration

Run `1983-msx-unapi-relay --help` for command-line options and
`1983-msx-unapi-relay --check-config` to validate the effective configuration
without opening a listener or printing the token.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `UNAPI_RELAY_HOST` | `127.0.0.1` | Listen address |
| `UNAPI_RELAY_PORT` | `1983` | Listen port |
| `UNAPI_RELAY_PATH` | `/unapi` | WebSocket path |
| `UNAPI_ORIGINS` | loopback origins | Comma-separated exact browser origins |
| `UNAPI_TOKEN` | empty | Optional shared URL-query token |
| `UNAPI_TOKEN_FILE` | empty | Read the token from a file instead |
| `UNAPI_TCP_PORTS` | `23,70,80,443,2323` | Allowed outbound TCP ports |
| `UNAPI_UDP_PORTS` | `123` | Allowed outbound UDP ports |
| `UNAPI_ALLOW_PRIVATE` | `false` | Permit private IPv4 destinations |
| `UNAPI_ALLOW_MISSING_ORIGIN` | `false` | Permit clients without an Origin header |
| `UNAPI_MAX_CLIENTS` | `16` | Simultaneous WebSocket clients |
| `UNAPI_MAX_CHANNELS` | `4` | TCP and UDP channels of each kind per client |
| `UNAPI_MAX_PAYLOAD` | `65536` | Maximum WebSocket message size |
| `UNAPI_CONNECT_TIMEOUT_MS` | `10000` | Outbound TCP connection timeout |
| `UNAPI_IDLE_TIMEOUT_MS` | `120000` | Idle channel timeout |

An explicitly empty `UNAPI_UDP_PORTS` value disables outbound UDP. Set only one
of `UNAPI_TOKEN` and `UNAPI_TOKEN_FILE`.

## Deployment

For a public browser application, keep the relay on loopback and publish it as
WSS through the same reverse proxy that serves 1983. Configure an exact origin,
a strong token, and only the destination ports actually required by the guest.

A hardened systemd unit and an environment-file template live under
`packaging/systemd`. See [Deployment](docs/DEPLOYMENT.md) for installation and
reverse-proxy examples.

The wire format is documented in [Protocol](docs/PROTOCOL.md).

### Fedora 42 RPM

Build the noarch binary RPM and source RPM in a Fedora 42 environment:

```sh
sudo dnf install nodejs rpm-build systemd-rpm-macros openssl git curl
packaging/rpm/build-rpm.sh
sudo dnf install ./build/rpm/RPMS/noarch/1983-msx-unapi-relay-*.rpm
```

The service is installed disabled, following Fedora service policy. Configure
`/etc/sysconfig/1983-msx-unapi-relay`, then manage it normally:

```sh
sudo systemctl enable --now 1983-msx-unapi-relay
systemctl status 1983-msx-unapi-relay
sudo systemctl restart 1983-msx-unapi-relay
sudo systemctl stop 1983-msx-unapi-relay
journalctl -u 1983-msx-unapi-relay
```

The RPM privately bundles the audited `ws` version pinned by `package-lock.json`
and verifies its SHA-512 integrity while building. It otherwise depends only on
Fedora's Node.js 20-or-newer runtime and systemd.

## Development

```sh
npm ci
npm run test:all
npm pack --dry-run
```

Tests use local TCP and UDP echo sockets; they do not contact Internet hosts.
CI exercises Node.js 20, 22, and 24.

## License

1983 MSX UNAPI Relay is free software under the GNU General Public License,
version 2 only. See [LICENSE](LICENSE).
