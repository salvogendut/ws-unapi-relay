#!/usr/bin/bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd -- "$script_dir/../.." && pwd)
package_name=ws-unapi-relay
version=$(node -p "require('$project_dir/package.json').version")
ws_version=$(node -p "require('$project_dir/package-lock.json').packages['node_modules/ws'].version")
ws_integrity=$(node -p "require('$project_dir/package-lock.json').packages['node_modules/ws'].integrity")
topdir=${RPMBUILD_TOPDIR:-$project_dir/build/rpm}
source_dir=$topdir/SOURCES

mkdir -p "$source_dir" "$topdir/BUILD" "$topdir/BUILDROOT" \
  "$topdir/RPMS" "$topdir/SRPMS" "$topdir/SPECS"

source_archive=$source_dir/$package_name-$version.tar.gz
dependency_archive=$source_dir/ws-$ws_version.tgz

git -C "$project_dir" archive --format=tar.gz \
  --prefix="$package_name-$version/" --output="$source_archive" HEAD

if [[ ! -f $dependency_archive ]]; then
  curl --fail --location --retry 3 \
    --output "$dependency_archive" \
    "https://registry.npmjs.org/ws/-/ws-$ws_version.tgz"
fi

expected_digest=${ws_integrity#sha512-}
actual_digest=$(openssl dgst -sha512 -binary "$dependency_archive" | openssl base64 -A)
if [[ $actual_digest != "$expected_digest" ]]; then
  echo "ws source archive failed the package-lock.json integrity check" >&2
  exit 1
fi

cp "$project_dir/$package_name.spec" "$topdir/SPECS/"
rpmbuild -ba --define "_topdir $topdir" "$topdir/SPECS/$package_name.spec"

find "$topdir/RPMS" "$topdir/SRPMS" -type f -name '*.rpm' -print
