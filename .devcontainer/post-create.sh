#!/usr/bin/env bash
set -euo pipefail

echo "=== Mocktail Dev Container Setup ==="

# ============================================================
# System packages
# ============================================================
# libxkbcommon0 is needed by the Playwright-bundled Chromium that the Karma
# (Angular `npm test`) runner launches as ChromeHeadless. Without it the
# browser fails to start with "libxkbcommon.so.0: cannot open shared object
# file" on the noble base image.
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends \
  curl wget jq htop xz-utils unzip libxkbcommon0

# ============================================================
# Firestore emulator (gcloud CLI installed by devcontainer feature)
# ============================================================
sudo apt-get install -y -qq --no-install-recommends google-cloud-cli-firestore-emulator
sudo apt-get clean && sudo rm -rf /var/lib/apt/lists/*

# ============================================================
# Generate Firestore protobuf-c sources from googleapis (one-time).
# Target backend/collab/proto/ because the zig build root is backend/collab/.
# ============================================================
if [ ! -d /workspace/backend/collab/proto/google/firestore ]; then
    echo "Generating Firestore protobuf-c sources..."
    PROTO_TMP=$(mktemp -d)
    git clone --depth=1 --filter=blob:none --sparse \
        https://github.com/googleapis/googleapis.git "$PROTO_TMP/googleapis"
    (cd "$PROTO_TMP/googleapis" && git sparse-checkout set \
        google/firestore/v1 google/rpc google/type google/api)

    mkdir -p /workspace/backend/collab/proto
    protoc-c \
        --proto_path="$PROTO_TMP/googleapis" \
        --proto_path=/usr/include \
        --c_out=/workspace/backend/collab/proto \
        google/firestore/v1/firestore.proto \
        google/firestore/v1/document.proto \
        google/firestore/v1/query.proto \
        google/firestore/v1/write.proto \
        google/firestore/v1/common.proto \
        google/rpc/status.proto \
        google/api/http.proto \
        google/api/annotations.proto \
        google/type/latlng.proto

    rm -rf "$PROTO_TMP"
    echo "Protobuf-c sources generated in /workspace/backend/collab/proto/"
else
    echo "Protobuf-c sources already exist, skipping generation"
fi

# ============================================================
# Zig 0.15.2
# ============================================================
ZIG_VERSION="0.15.2"
ZIG_ARCH="$(uname -m)"
if [ "$ZIG_ARCH" = "x86_64" ]; then
  ZIG_TARGET="x86_64-linux"
elif [ "$ZIG_ARCH" = "aarch64" ]; then
  ZIG_TARGET="aarch64-linux"
else
  echo "Unsupported architecture: $ZIG_ARCH"
  exit 1
fi

echo "Installing Zig ${ZIG_VERSION} for ${ZIG_TARGET}..."
curl -sL "https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_TARGET}-${ZIG_VERSION}.tar.xz" | sudo tar -xJ -C /usr/local
sudo ln -sf "/usr/local/zig-${ZIG_TARGET}-${ZIG_VERSION}/zig" /usr/local/bin/zig

# ============================================================
# ZLS (Zig Language Server)
# ============================================================
echo "Installing ZLS..."
ZLS_URL="https://github.com/zigtools/zls/releases/latest/download/zls-${ZIG_TARGET}.tar.xz"
curl -sL "$ZLS_URL" | sudo tar -xJ -C /usr/local/bin

# ============================================================
# Deno (for backend/email-auth-service)
# ============================================================
DENO_ARCH="$(uname -m)"
if [ "$DENO_ARCH" = "x86_64" ]; then
  DENO_TARGET="x86_64-unknown-linux-gnu"
elif [ "$DENO_ARCH" = "aarch64" ]; then
  DENO_TARGET="aarch64-unknown-linux-gnu"
else
  echo "Unsupported architecture for Deno: $DENO_ARCH"
  exit 1
fi

echo "Installing Deno for ${DENO_TARGET}..."
DENO_TMP=$(mktemp -d)
curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_TARGET}.zip" \
  -o "$DENO_TMP/deno.zip"
sudo unzip -q -o "$DENO_TMP/deno.zip" -d /usr/local/bin
sudo chmod +x /usr/local/bin/deno
rm -rf "$DENO_TMP"

# ============================================================
# Claude Code config
# ============================================================
if [ -f ~/.claude/.claude.json ] && [ ! -e ~/.claude.json ]; then
    ln -s ~/.claude/.claude.json ~/.claude.json
fi

# ============================================================
# NPM config
# ============================================================
npm config set cache ~/.npm
npm config set update-notifier false
npm config set fund false
npm config set audit false

# ============================================================
# Angular CLI (global, for `ng` convenience)
# ============================================================
echo "Installing Angular CLI..."
sudo npm install -g @angular/cli@latest

# ============================================================
# Playwright (global CLI + browser + OS deps)
# ============================================================
echo "Installing Playwright CLI..."
sudo npm install -g @playwright/cli@latest
playwright-cli install --skills || true

# Frontend dependencies — install once so VSCode + tests work immediately.
if [ -f /workspace/frontend/package.json ]; then
    echo "Installing frontend dependencies..."
    (cd /workspace/frontend && npm install)
    # Install Playwright browsers + OS deps for CI/headless runs.
    (cd /workspace/frontend && npx playwright install --with-deps chromium) || true
fi

# ============================================================
# Git config
# ============================================================
git config --global --add safe.directory /workspace
git config --global init.defaultBranch main
git config --global core.autocrlf input

# ============================================================
# Shell aliases
# ============================================================
cat >> ~/.zshrc << 'ALIASES'

# Claude
alias claude="claude --dangerously-skip-permissions"

# Zig shortcuts (run from backend/collab/)
alias zb="(cd /workspace/backend/collab && zig build)"
alias zt="(cd /workspace/backend/collab && zig build test)"
alias zr="(cd /workspace/backend/collab && zig build run)"
alias zfmt="(cd /workspace/backend/collab && zig fmt src/)"

# Angular (run from frontend/)
alias ng-serve="(cd /workspace/frontend && npm start)"
alias ng-build="(cd /workspace/frontend && npm run build)"
alias ng-test="(cd /workspace/frontend && npm test)"

# Playwright e2e (frontend/)
alias e2e="(cd /workspace/frontend && npm run e2e)"
alias e2e-ui="(cd /workspace/frontend && npm run e2e:ui)"

# Firebase / Firestore
alias fb-emulator="gcloud emulators firestore start --host-port=0.0.0.0:8083 --project=demo-mocktail"
alias fb-ui="firebase emulators:start --project=demo-mocktail"
alias fb-hosting="firebase emulators:start --only hosting --project=demo-mocktail"
alias fb-deploy-hosting="firebase deploy --only hosting"

# Cloud Run / Docker (collab backend image)
alias docker-build="(cd /workspace/backend/collab && docker build -t mocktail:local -f Dockerfile .)"
alias docker-run="docker run --rm -p 8082:8082 mocktail:local"

# Deno email-auth sidecar (backend/email-auth-service/)
alias deno-serve="(cd /workspace/backend/email-auth-service && PORT=8085 deno run --allow-net --allow-env --allow-read main.ts)"

# Git shortcuts
alias gs="git status"
alias gd="git diff"
alias gl="git log --oneline -20"

ALIASES

[ -f ~/.bashrc ] && ! grep -q 'exec zsh' ~/.bashrc && echo '[ -t 1 ] && exec zsh' >> ~/.bashrc

# ============================================================
# Verify installations
# ============================================================
echo ""
echo "=== Installed versions ==="
zig version
zls --version 2>/dev/null || echo "ZLS: installed"
node --version
npm --version
ng version 2>/dev/null | head -3 || echo "angular-cli: installed"
firebase --version
deno --version | head -1
protoc --version
protoc-c --version 2>/dev/null || echo "protoc-c: installed"
pkg-config --modversion grpc 2>/dev/null && echo "grpc: $(pkg-config --modversion grpc)" || echo "grpc: installed"
pkg-config --modversion libprotobuf-c 2>/dev/null && echo "protobuf-c: $(pkg-config --modversion libprotobuf-c)" || echo "protobuf-c: installed"
playwright-cli --version 2>/dev/null || echo "playwright-cli: installed"
git --version

echo ""
echo "=== Setup complete ==="
echo ""
echo "Backend collab (Zig WS server on :8082):"
echo "  zb               -> zig build"
echo "  zr               -> zig build run"
echo "  zt               -> zig build test"
echo ""
echo "Frontend (Angular on :4200, proxy /api -> :8082):"
echo "  ng-serve         -> npm start"
echo "  ng-build         -> npm run build"
echo "  e2e              -> Playwright e2e tests"
echo ""
echo "Firebase:"
echo "  fb-hosting       -> firebase hosting emulator on :5000"
echo "  fb-ui            -> all firebase emulators (UI on :4000)"
echo ""
