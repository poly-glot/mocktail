FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Node.js 22 (for Firebase CLI & tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Build deps + gRPC / protobuf-c development libraries (for Firestore client)
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    pkg-config \
    build-essential \
    ca-certificates \
    libgrpc-dev \
    libgrpc++-dev \
    libprotobuf-c-dev \
    protobuf-c-compiler \
    protobuf-compiler \
    libprotobuf-dev \
    openjdk-21-jre-headless \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Firebase CLI
RUN npm install -g firebase-tools

USER vscode
WORKDIR /workspace
