# Deployment

## Fedora 42 RPM

The repository contains a Fedora-compatible spec file and a reproducible helper
which creates both a noarch binary RPM and a source RPM:

```sh
sudo dnf install nodejs rpm-build systemd-rpm-macros openssl git curl
packaging/rpm/build-rpm.sh
sudo dnf install ./build/rpm/RPMS/noarch/ws-unapi-relay-*.rpm
```

The helper creates packages under `build/rpm/`. It downloads the `ws` source
archive pinned by `package-lock.json` and rejects it unless its SHA-512 digest
matches the lockfile. The dependency is installed privately beneath
`/usr/libexec/ws-unapi-relay`; it does not modify the global npm tree.

RPM installation provides:

- `/usr/bin/ws-unapi-relay`;
- `/usr/lib/systemd/system/ws-unapi-relay.service`;
- `/etc/sysconfig/ws-unapi-relay` as a mode-0600, configuration-preserving
  file;
- the application and private dependency under `/usr/libexec`;
- protocol and deployment documentation.

The service is intentionally not started automatically during package
installation. Review the sysconfig file, then use the normal system service
lifecycle:

```sh
sudo systemctl enable --now ws-unapi-relay
systemctl status ws-unapi-relay
sudo systemctl restart ws-unapi-relay
sudo systemctl stop ws-unapi-relay
journalctl -u ws-unapi-relay
```

After changing `/etc/sysconfig/ws-unapi-relay`, restart the service. A
`systemctl daemon-reload` is needed only when the unit itself changes.

## Install the Node.js service

The RPM above is preferred on Fedora. On other systemd distributions, install
the application globally from a release checkout:

```sh
npm ci
sudo npm install --global .
sudo install -D -m 0644 packaging/systemd/ws-unapi-relay.service \
  /etc/systemd/system/ws-unapi-relay.service
sudo install -D -m 0600 packaging/systemd/ws-unapi-relay.sysconfig \
  /etc/sysconfig/ws-unapi-relay
sudo systemctl daemon-reload
sudo systemctl enable --now ws-unapi-relay
```

Validate the local endpoint:

```sh
curl --fail http://127.0.0.1:9380/healthz
systemctl status ws-unapi-relay
```

The supplied unit uses a transient unprivileged user and a read-only filesystem.
It needs no writable application state.

For a systemd deployment, put `UNAPI_TOKEN=...` in the mode-0600 sysconfig file;
systemd reads it before dropping privileges. For an interactive or dedicated
service-user deployment, `UNAPI_TOKEN_FILE` avoids placing the token on the
command line.

## Nginx reverse proxy

An HTTPS site must expose a WSS endpoint. The following location keeps the
relay itself on loopback:

```nginx
location = /unapi {
    proxy_pass http://127.0.0.1:9380;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 130s;
}
```

If the emulator frontend is `https://emulator.example.org`, configure:

```ini
UNAPI_ORIGINS=https://emulator.example.org
UNAPI_TOKEN=replace-with-a-long-random-value
```

The browser endpoint is then:

```text
wss://emulator.example.org/unapi?token=replace-with-a-long-random-value
```

The token is a second gate, not a replacement for exact origin checks. Treat it
as a secret and avoid access logs that retain URL query strings.

## Caddy reverse proxy

Caddy handles the WebSocket upgrade automatically:

```caddyfile
emulator.example.org {
    handle /unapi {
        reverse_proxy 127.0.0.1:9380
    }

    handle {
        root * /srv/emulator
        file_server
    }
}
```

### LAN WSS for the hosted emulator

An HTTPS page such as
`https://salvogendut.github.io/chimeric/emulator/` cannot connect to a plain
`ws://` relay. A Caddy instance on the relay host can provide WSS on the normal
HTTPS port while the Node.js service remains private on loopback:

```caddyfile
https://192.168.68.223 {
    tls internal
    reverse_proxy 127.0.0.1:9380
}
```

Set the relay's exact browser origin in
`/etc/sysconfig/ws-unapi-relay`:

```ini
UNAPI_RELAY_HOST=127.0.0.1
UNAPI_ORIGINS=https://salvogendut.github.io
```

Restart both services after validating their configuration:

```sh
sudo systemctl restart ws-unapi-relay
sudo systemctl reload caddy
curl --insecure https://192.168.68.223/healthz
```

The `--insecure` option is appropriate only for this initial diagnostic. Copy
Caddy's public root certificate from
`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` to each
browser machine and import it as a trusted certificate authority. Never copy
the CA private key. The emulator AUX panel's **Trust certificate** action opens the
same health endpoint to make browser approval easier.

Configure the browser application with:

```text
wss://192.168.68.223/unapi
```

Replace the example address with the relay host's stable LAN address. Only TCP
443 needs to cross the host firewall; port 9380 should remain private.

## Safety checklist

- Keep `UNAPI_RELAY_HOST=127.0.0.1` when a local reverse proxy is used.
- Set `UNAPI_ORIGINS` to the exact HTTPS frontend origin.
- Configure a strong random `UNAPI_TOKEN` for public deployments.
- Narrow `UNAPI_TCP_PORTS` and `UNAPI_UDP_PORTS` to guest requirements.
- Leave `UNAPI_ALLOW_PRIVATE=false` on any public or shared service.
- Keep the reverse proxy and Node.js runtime updated.
- Monitor `/healthz`, service restarts, and rejected connection rates.
