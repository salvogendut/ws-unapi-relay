%global ws_version 8.21.3

Name:           1983-msx-unapi-relay
Version:        0.1.0
Release:        1%{?dist}
Summary:        Restricted WebSocket relay for MSX TCP/IP UNAPI clients

License:        GPL-2.0-only AND MIT
URL:            https://github.com/salvogendut/1983-msx-unapi-relay
Source0:        %{url}/archive/v%{version}/%{name}-%{version}.tar.gz
Source1:        https://registry.npmjs.org/ws/-/ws-%{ws_version}.tgz

BuildArch:      noarch
BuildRequires:  nodejs >= 20
BuildRequires:  systemd-rpm-macros
Requires:       nodejs >= 20
Provides:       bundled(nodejs-ws) = %{ws_version}
%{?systemd_requires}

%description
1983 MSX UNAPI Relay is a restricted WebSocket-to-TCP/UDP relay for the
WebAssembly edition of the 1983 MSX/MSX2 emulator. It provides DNS, outbound
TCP, and outbound UDP to guest TCP/IP UNAPI software while enforcing browser
origin checks, destination address and port policy, resource limits, optional
token authentication, and idle timeouts.

The package installs a hardened systemd service which listens on loopback by
default and is configured through /etc/sysconfig/1983-msx-unapi-relay.

%prep
%autosetup
mkdir -p node_modules/ws
tar -xzf %{SOURCE1} --strip-components=1 -C node_modules/ws

%build
# The relay is plain JavaScript and requires no compilation.

%check
node --check src/config.js
node --check src/protocol.js
node --check src/relay.js
node --check bin/1983-msx-unapi-relay.js
node --test test/*.test.js
systemd-analyze verify packaging/systemd/1983-msx-unapi-relay.service

%install
install -d %{buildroot}%{_bindir}
install -d %{buildroot}%{_libexecdir}/%{name}
install -d %{buildroot}%{_unitdir}
install -d %{buildroot}%{_sysconfdir}/sysconfig

cp -a bin src node_modules package.json %{buildroot}%{_libexecdir}/%{name}/
ln -s ../libexec/%{name}/bin/%{name}.js %{buildroot}%{_bindir}/%{name}
install -m 0644 packaging/systemd/%{name}.service \
  %{buildroot}%{_unitdir}/%{name}.service
install -m 0600 packaging/systemd/%{name}.sysconfig \
  %{buildroot}%{_sysconfdir}/sysconfig/%{name}

%post
%systemd_post %{name}.service

%preun
%systemd_preun %{name}.service

%postun
%systemd_postun_with_restart %{name}.service

%files
%license LICENSE
%doc README.md docs/DEPLOYMENT.md docs/PROTOCOL.md
%{_bindir}/%{name}
%dir %{_libexecdir}/%{name}
%{_libexecdir}/%{name}/bin
%{_libexecdir}/%{name}/src
%{_libexecdir}/%{name}/package.json
%dir %{_libexecdir}/%{name}/node_modules
%dir %{_libexecdir}/%{name}/node_modules/ws
%license %{_libexecdir}/%{name}/node_modules/ws/LICENSE
%doc %{_libexecdir}/%{name}/node_modules/ws/README.md
%{_libexecdir}/%{name}/node_modules/ws/browser.js
%{_libexecdir}/%{name}/node_modules/ws/index.js
%{_libexecdir}/%{name}/node_modules/ws/package.json
%{_libexecdir}/%{name}/node_modules/ws/wrapper.mjs
%{_libexecdir}/%{name}/node_modules/ws/lib
%{_unitdir}/%{name}.service
%config(noreplace) %{_sysconfdir}/sysconfig/%{name}

%changelog
* Sat Aug 15 2026 Salvatore Bognanni <salvogendut@gmail.com> - 0.1.0-1
- Package the standalone DNS, TCP, and UDP MSX UNAPI relay.
- Add a hardened systemd service and sysconfig policy file.
- Bundle the audited ws 8.21.3 dependency for Fedora 42 compatibility.
