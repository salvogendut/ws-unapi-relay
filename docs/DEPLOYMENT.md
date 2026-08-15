# Deployment

## Install the Node.js service

Install the application globally from a release checkout:

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
