#!/bin/sh

set -u

REPOSITORY="reggie-db/vscode-mods"

fail() {
  printf '%s\n' "[vscode-mods] install failed: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

asset="vscode-mods-${os}-${arch}.tar.gz"
release_base="https://github.com/${REPOSITORY}/releases/latest/download"
temporary_directory="$(mktemp -d 2>/dev/null)" || fail "could not create a temporary directory"
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

curl -fsSL "${release_base}/${asset}" -o "${temporary_directory}/${asset}" || fail "could not download ${asset}"
curl -fsSL "${release_base}/checksums.txt" -o "${temporary_directory}/checksums.txt" || fail "could not download checksums"

expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "${temporary_directory}/checksums.txt")"
[ -n "$expected" ] || fail "${asset} is missing from checksums.txt"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${temporary_directory}/${asset}" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "${temporary_directory}/${asset}" | awk '{ print $1 }')"
fi
[ "$actual" = "$expected" ] || fail "checksum verification failed for ${asset}"

payload="${temporary_directory}/payload"
mkdir -p "$payload" || fail "could not prepare the install payload"
tar -xzf "${temporary_directory}/${asset}" -C "$payload" || fail "could not extract ${asset}"

data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
install_root="${VSCODE_MODS_HOME:-${data_home}/vscode-mods}"
previous_root="${install_root}.previous"
parent_root="$(dirname "$install_root")"
mkdir -p "$parent_root" || fail "could not create ${parent_root}"

if [ -e "$previous_root" ]; then
  rm -rf "$previous_root" || fail "could not remove stale installer backup"
fi
if [ -e "$install_root" ]; then
  mv "$install_root" "$previous_root" || fail "could not preserve the previous installation"
fi
if ! mv "$payload" "$install_root"; then
  [ ! -e "$previous_root" ] || mv "$previous_root" "$install_root"
  fail "could not install into ${install_root}"
fi
if [ -e "$previous_root" ]; then
  rm -rf "$previous_root" || printf '%s\n' "[vscode-mods] warning: could not remove ${previous_root}" >&2
fi

user_bin="${HOME}/.local/bin"
mkdir -p "$user_bin" || fail "could not create ${user_bin}"
ln -sf "${install_root}/bin/vscode-mods" "${user_bin}/vscode-mods" || fail "could not create the command link"

printf '%s\n' "[vscode-mods] installed in ${install_root}"
"${install_root}/bin/vscode-mods" apply
printf '%s\n' "[vscode-mods] reload the VS Code window to display the changes"
case ":${PATH}:" in
  *":${user_bin}:"*) ;;
  *) printf '%s\n' "[vscode-mods] add ${user_bin} to PATH to run vscode-mods directly" ;;
esac

