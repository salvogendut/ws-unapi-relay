# Using the relay with GB-proxy

[GB-proxy](https://github.com/salvogendut/GB-proxy) converts modern web pages
and images into forms that the GEOBENCH browser can consume. It is a separate
HTTP service. When GB-proxy and this relay run on the same machine, the complete
path is:

```text
GEOBENCH -> UNAPINET.COM -> emulator WASM -> WSS relay
         -> http://127.0.0.1:5001 -> GB-proxy -> Internet
```

## Run GB-proxy beside the relay

Install GB-proxy using its own README and select its `geobench` preset. Keep it
on its default loopback listener when only the UNAPI relay needs to reach it:

```ini
GB_PROXY_HOST=127.0.0.1
GB_PROXY_PORT=5001
GB_PROXY_ADVERTISE_HOST=127.0.0.1
```

Then enable and verify both services:

```sh
sudo systemctl enable --now gb-proxy
sudo systemctl restart ws-unapi-relay
ss -ltn 'sport = :5001'
curl --fail http://127.0.0.1:9380/healthz
```

Port 5001 does not need a firewall exception in this arrangement.

## Permit the proxy destination

The relay intentionally denies private addresses and TCP port 5001 by default.
Add port 5001 and explicitly permit private destinations in
`/etc/sysconfig/ws-unapi-relay`:

```ini
UNAPI_TCP_PORTS=23,70,80,443,2323,5001
UNAPI_ALLOW_PRIVATE=true
```

Restart the relay after changing the sysconfig file. If the relay is reachable
from other machines, also configure an exact `UNAPI_ORIGINS` value and a strong
`UNAPI_TOKEN`. Enabling private destinations broadens the relay's reach, so do
not use this setting on an unrestricted public relay.

## Configure the emulator and GEOBENCH

The two endpoints are deliberately different:

```text
Emulator AUX relay endpoint:  wss://192.168.68.223/unapi
GEOBENCH HTTP proxy:      http://127.0.0.1:5001
```

The loopback address in GEOBENCH refers to the relay host, because the relay is
the component that creates the TCP connection. It does not refer to the browser
or the emulated guest. GB-proxy also advertises that loopback URL in rewritten links,
so subsequent page and image requests follow the same path.

After saving the GEOBENCH proxy setting, open a page through the browser. A
`Connect failed` message usually means port 5001 is absent from
`UNAPI_TCP_PORTS`, `UNAPI_ALLOW_PRIVATE` is still false, or GB-proxy is not
listening on `127.0.0.1:5001`.
