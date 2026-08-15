# Running ws-unapi-relay and GB-proxy on one machine

[GB-proxy](https://github.com/salvogendut/GB-proxy) converts modern web pages
and images into forms that GEOBENCH and other constrained HTTP clients can
consume. It is a separate HTTP service. This guide assumes GB-proxy,
ws-unapi-relay, and Caddy all run on the same host.

## How the pieces fit together

```text
Browser-hosted emulator
    |  wss://relay.example.org/unapi
    v
Caddy :443 (TLS and WebSocket upgrade)
    |  ws://127.0.0.1:9380/unapi
    v
ws-unapi-relay
    |  guest opens http://127.0.0.1:5001
    v
GB-proxy :5001
    |
    v
Modern Internet
```

The guest still needs its normal network driver, such as `UNAPINET.COM` for
GEOBENCH. Caddy is the browser-facing TLS and WebSocket glue: it forwards the
relay endpoint to ws-unapi-relay. It does not sit between ws-unapi-relay and
GB-proxy. The relay makes that final TCP connection directly over host
loopback.

| Component | Listener | Exposure |
| --- | --- | --- |
| Caddy | TCP 443 | LAN or Internet, as appropriate |
| ws-unapi-relay | `127.0.0.1:9380` | Host loopback only |
| GB-proxy | `127.0.0.1:5001` | Host loopback only |

Of the three application listeners, only port 443 needs a firewall exception.
A public Caddy deployment may also need TCP port 80 for automatic HTTPS. Do
not expose ports 9380 or 5001 when all three services run on the same machine.

## 1. Configure GB-proxy

Install GB-proxy using its own README. For GEOBENCH, select its compatibility
preset in `/etc/gb-proxy/config.py`:

```python
PRESET = "geobench"
```

Keep the packaged service on loopback and make it advertise the same loopback
URL that the guest will use. In `/etc/sysconfig/gb-proxy`, set:

```ini
GB_PROXY_HOST=127.0.0.1
GB_PROXY_PORT=5001
GB_PROXY_ADVERTISE_HOST=127.0.0.1
```

`GB_PROXY_ADVERTISE_HOST` matters because GB-proxy places proxy-local links in
rewritten pages. Advertising `127.0.0.1` keeps those page, link, and image
requests on the same guest-to-relay-to-GB-proxy route.

Start the service, then validate the configuration as its dedicated user:

```sh
sudo systemctl enable --now gb-proxy
sudo -u gb-proxy /usr/bin/gb-proxy --check-config
systemctl status gb-proxy
ss -ltn 'sport = :5001'
```

## 2. Permit GB-proxy through ws-unapi-relay

The relay denies loopback/private destinations and TCP port 5001 by default.
For a deployment used only through GB-proxy, the narrowest relevant settings
in `/etc/sysconfig/ws-unapi-relay` are:

```ini
UNAPI_RELAY_HOST=127.0.0.1
UNAPI_RELAY_PORT=9380
UNAPI_RELAY_PATH=/unapi
UNAPI_ORIGINS=https://emulator.example.org
UNAPI_TOKEN=replace-with-a-long-random-value
UNAPI_TCP_PORTS=5001
UNAPI_ALLOW_PRIVATE=true
```

Set `UNAPI_ORIGINS` to the origin of the page running the emulator, not the
Caddy relay URL. An origin contains only the scheme, hostname, and optional
port; it does not contain a path. If guest software also needs direct Telnet,
Gopher, HTTP, or HTTPS connections, append only those required ports, for
example:

```ini
UNAPI_TCP_PORTS=23,70,80,443,2323,5001
```

Enabling private destinations broadens what a connected guest can reach.
Keeping the port list narrow, requiring the exact browser origin, and using a
strong token are especially important here.

Restart and verify the relay. Invalid service settings cause the restart to
fail before a listener is opened:

```sh
sudo systemctl restart ws-unapi-relay
systemctl status ws-unapi-relay
curl --fail http://127.0.0.1:9380/healthz
```

## 3. Put Caddy in front of the relay

With a public DNS name, a minimal `/etc/caddy/Caddyfile` is:

```caddyfile
relay.example.org {
    route {
        @relay path /unapi /healthz
        reverse_proxy @relay 127.0.0.1:9380

        respond 404
    }
}
```

Caddy obtains a public certificate and handles the WebSocket upgrade
automatically. The `/healthz` route is included because the emulator's
**Trust certificate** action and normal diagnostics use it.

For a LAN IP address without public DNS, use Caddy's internal CA instead:

```caddyfile
https://192.168.68.223 {
    tls internal

    route {
        @relay path /unapi /healthz
        reverse_proxy @relay 127.0.0.1:9380

        respond 404
    }
}
```

Validate and activate the configuration:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
curl --fail https://relay.example.org/healthz
```

For `tls internal`, trust Caddy's root certificate on the browser machine
before removing `--insecure` from an initial diagnostic `curl`. Never copy the
CA private key.

Do not add a Caddy route to `127.0.0.1:5001`. GEOBENCH speaks plain HTTP to
GB-proxy through the relay; publishing GB-proxy through Caddy is unnecessary
and would expose a service intended to remain private.

## 4. Configure the emulator and guest

The browser and guest use different endpoints:

```text
Emulator AUX relay endpoint:  wss://relay.example.org/unapi?token=...
GEOBENCH HTTP proxy:          http://127.0.0.1:5001
```

For the LAN-IP Caddy example, the relay endpoint is
`wss://192.168.68.223/unapi?token=...` instead.

The guest's `127.0.0.1` does not mean the browser machine or an emulated
loopback interface in this arrangement. The guest asks ws-unapi-relay to open
that address, and the relay resolves it in the host network namespace, where
GB-proxy is listening.

In GEOBENCH, enter `http://127.0.0.1:5001` in `BROWSER.APP`'s HTTP proxy
setting. After saving it, open a page through the browser. GB-proxy's rewritten
links and images will continue to use the same address.

Other guest operating systems and applications can use the same arrangement
when all of the following are true:

- their TCP/IP stack is backed by the emulator's ws-unapi-relay bridge;
- their browser supports an explicit HTTP proxy;
- the proxy can be set to `http://127.0.0.1:5001`;
- GB-proxy has a suitable preset or output mode for that browser.

GB-proxy is an HTTP content-adapting proxy, not SOCKS, a transparent IP
gateway, or a general operating-system network service. Applications without
HTTP-proxy support will not use it automatically, though they may still make
direct connections through ws-unapi-relay when the destination ports are
allowlisted.

## Verify and troubleshoot

On the shared host, all three listeners should be present:

```sh
ss -ltn '( sport = :443 or sport = :9380 or sport = :5001 )'
systemctl status caddy ws-unapi-relay gb-proxy
journalctl -u caddy -u ws-unapi-relay -u gb-proxy --since -10m
```

Common symptoms:

| Symptom | Likely cause |
| --- | --- |
| Caddy returns `502` | The relay is stopped or its loopback listener is wrong. |
| WebSocket is rejected | The origin or token does not match the relay configuration. |
| GEOBENCH reports `Connect failed` | Port 5001 or private addresses are denied, or GB-proxy is stopped. |
| Links or images fail | GB-proxy is not advertising `127.0.0.1`. |
| Certificate error | The internal CA is untrusted, or public issuance failed. |
| Unsuitable GEOBENCH output | The `geobench` preset is disabled. |
