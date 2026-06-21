#!/usr/bin/env bash
set -u

expected_node="$(tr -d '[:space:]' < .node-version)"
expected_pnpm="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' package.json | head -1)"
platform="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"

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

node_actual="$(run_with_timeout 5 node --version | tr -d '[:space:]')"
node_status="$?"
pnpm_actual="$(run_with_timeout 5 pnpm --version | tr -d '[:space:]')"
pnpm_status="$?"
if [ "$pnpm_status" -ne 0 ] && [ -n "${npm_config_user_agent:-}" ]; then
  pnpm_actual="$(printf '%s\n' "$npm_config_user_agent" | sed -n 's/^pnpm\/\([^ ]*\).*/\1/p')"
  if [ -n "$pnpm_actual" ]; then
    pnpm_status=0
  fi
fi

echo "VEEL toolchain doctor"
echo "Node expected: ${expected_node}"
echo "Node actual:   ${node_actual:-unavailable}"
echo "pnpm expected: ${expected_pnpm}"
echo "pnpm actual:   ${pnpm_actual:-unavailable}"
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
