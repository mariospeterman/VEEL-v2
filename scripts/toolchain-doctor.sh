#!/usr/bin/env bash
set -u

expected_node="$(tr -d '[:space:]' < .node-version)"
expected_pnpm="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' package.json | head -1)"
platform="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"

find_node_binary() {
  local candidate nvm_root

  if [ -n "${VEEL_NODE_BINARY:-}" ] && [ -x "$VEEL_NODE_BINARY" ]; then
    printf '%s\n' "$VEEL_NODE_BINARY"
    return 0
  fi

  nvm_root="${HOME:-}/.nvm/versions/node/v${expected_node}/bin/node"
  if [ -x "$nvm_root" ]; then
    printf '%s\n' "$nvm_root"
    return 0
  fi

  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      if [ "$("$candidate" --version 2>/dev/null | tr -d '[:space:]')" = "v${expected_node}" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
  done

  return 1
}

node_binary="$(find_node_binary || true)"
corepack_binary=""

if [ -n "$node_binary" ] && [ -x "$(dirname "$node_binary")/corepack" ]; then
  corepack_binary="$(dirname "$node_binary")/corepack"
elif command -v corepack >/dev/null 2>&1; then
  corepack_binary="$(command -v corepack)"
fi

run_with_timeout() {
  local seconds="$1"
  shift
  local stdout_file stderr_file pid elapsed status
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"
  "$@" >"$stdout_file" 2>"$stderr_file" &
  pid="$!"
  elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$seconds" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      rm -f "$stdout_file" "$stderr_file"
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
  status="$?"
  cat "$stdout_file"
  cat "$stderr_file" >&2
  rm -f "$stdout_file" "$stderr_file"
  return "$status"
}

if [ -n "$node_binary" ]; then
  node_actual="$(run_with_timeout 5 "$node_binary" --version | tr -d '[:space:]')"
  node_status="$?"
else
  node_actual=""
  node_status=1
fi

if [ -n "$corepack_binary" ]; then
  pnpm_actual="$(run_with_timeout 30 "$corepack_binary" pnpm --version | tr -d '[:space:]')"
  pnpm_status="$?"
elif command -v pnpm >/dev/null 2>&1; then
  pnpm_actual="$(run_with_timeout 5 pnpm --version | tr -d '[:space:]')"
  pnpm_status="$?"
else
  pnpm_actual=""
  pnpm_status=1
fi
if [ "$pnpm_status" -ne 0 ] && [ -n "${npm_config_user_agent:-}" ]; then
  pnpm_actual="$(printf '%s\n' "$npm_config_user_agent" | sed -n 's/^pnpm\/\([^ ]*\).*/\1/p')"
  if [ -n "$pnpm_actual" ]; then
    pnpm_status=0
  fi
fi

echo "VEEL toolchain doctor"
echo "Node expected: ${expected_node}"
echo "Node actual:   ${node_actual:-unavailable}"
echo "Node binary:   ${node_binary:-unavailable}"
echo "pnpm expected: ${expected_pnpm}"
echo "pnpm actual:   ${pnpm_actual:-unavailable}"
echo "Corepack:      ${corepack_binary:-unavailable}"
echo "platform:      ${platform} ${arch}"

if [ "$node_status" -eq 124 ]; then
  echo "status:        failed (node --version timed out)"
  exit 1
fi

if [ "$pnpm_status" -eq 124 ]; then
  echo "status:        failed (pnpm --version timed out)"
  exit 1
fi

if [ "$node_status" -ne 0 ]; then
  echo "status:        failed (node --version failed)"
  exit 1
fi

if [ "$pnpm_status" -ne 0 ]; then
  echo "status:        failed (pnpm --version failed)"
  exit 1
fi

if [ "$node_actual" != "v${expected_node}" ]; then
  echo "status:        failed (Node version mismatch)"
  exit 1
fi

if [ "$pnpm_actual" != "$expected_pnpm" ]; then
  echo "status:        failed (pnpm version mismatch)"
  exit 1
fi

echo "status:        ok"
