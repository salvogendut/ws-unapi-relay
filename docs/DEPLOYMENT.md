# Deployment

## Fedora 42 RPM

The repository contains a Fedora-compatible spec file and a reproducible helper
which creates both a noarch binary RPM and a source RPM:

```sh
sudo dnf install nodejs rpm-build systemd-rpm-macros openssl git curl
packaging/rpm/build-rpm.sh
sudo dnf install ./build/rpm/RPMS/noarch/1983-msx-unapi-relay-*.rpm
```

The helper creates packages under `build/rpm/`. It downloads the `ws` source
archive pinned by `package-lock.json` and rejects it unless its SHA-512 digest
matches the lockfile. The dependency is installed privately beneath
`/usr/libexec/1983-msx-unapi-relay`; it does not modify the global npm tree.

RPM installation provides:

- `/usr/bin/1983-msx-unapi-relay`;
- `/usr/lib/systemd/system/1983-msx-unapi-relay.service`;
- `/etc/sysconfig/1983-msx-unapi-relay` as a mode-0600, configuration-preserving
  file;
- the application and private dependency under `/usr/libexec`;
- protocol and deployment documentation.

The service is intentionally not started automatically during package
installation. Review the sysconfig file, then use the normal system service
lifecycle:

```sh
sudo systemctl enable --now 1983-msx-unapi-relay
systemctl status 1983-msx-unapi-relay
sudo systemctl restart 1983-msx-unapi-relay
sudo systemctl stop 1983-msx-unapi-relay
journalctl -u 1983-msx-unapi-relay
```

After changing `/etc/sysconfig/1983-msx-unapi-relay`, restart the service. A
`systemctl daemon-reload` is needed only when the unit itself changes.

## Install the Node.js service

The RPM above is preferred on Fedora. On other systemd distributions, install
the application globally from a release checkout:

```sh
npm ci
sudo npm install --global .
sudo install -D -m 0644 packaging/systemd/1983-msx-unapi-relay.service \
  /etc/systemd/system/1983-msx-unapi-relay.service
sudo install -D -m 0600 packaging/systemd/1983-msx-unapi-relay.sysconfig \
  /etc/sysconfig/1983-msx-unapi-relay
sudo systemctl daemon-reload
sudo systemctl enable --now 1983-msx-unapi-relay
```

Validate the local endpoint:

```sh
curl --fail http://127.0.0.1:1983/healthz
systemctl status 1983-msx-unapi-relay
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
    proxy_pass http://127.0.0.1:1983;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 130s;
}
```

If the 1983 frontend is `https://1983.example.org`, configure:

```ini
UNAPI_ORIGINS=https://1983.example.org
UNAPI_TOKEN=replace-with-a-long-random-value
```

The browser endpoint is then:

```text
wss://1983.example.org/unapi?token=replace-with-a-long-random-value
```

The token is a second gate, not a replacement for exact origin checks. Treat it
as a secret and avoid access logs that retain URL query strings.

## Caddy reverse proxy

Caddy handles the WebSocket upgrade automatically:

```caddyfile
1983.example.org {
    handle /unapi {
        reverse_proxy 127.0.0.1:1983
    }

    handle {
        root * /srv/1983
        file_server
    }
}
```

## Safety checklist

- Keep `UNAPI_RELAY_HOST=127.0.0.1` when a local reverse proxy is used.
- Set `UNAPI_ORIGINS` to the exact HTTPS frontend origin.
- Configure a strong random `UNAPI_TOKEN` for public deployments.
- Narrow `UNAPI_TCP_PORTS` and `UNAPI_UDP_PORTS` to guest requirements.
- Leave `UNAPI_ALLOW_PRIVATE=false` on any public or shared service.
- Keep the reverse proxy and Node.js runtime updated.
- Monitor `/healthz`, service restarts, and rejected connection rates.
