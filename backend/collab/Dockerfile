# syntax=docker/dockerfile:1.7

# ---- Builder ---------------------------------------------------------------
# Must be glibc-based (not alpine/musl) because we dynamically link against
# the system's libgrpc / libprotobuf-c. Cross-compiling static musl binaries
# with grpc is painful and not worth it here.
FROM debian:12-slim AS builder

ARG ZIG_VERSION=0.15.2
ARG TARGETARCH

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      curl xz-utils ca-certificates git \
      build-essential pkg-config \
      libgrpc-dev libprotobuf-c-dev protobuf-c-compiler protobuf-compiler libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) ZIG_TARGET=x86_64-linux; ZIG_CPU=x86_64_v3 ;; \
      arm64) ZIG_TARGET=aarch64-linux; ZIG_CPU=baseline ;; \
      *)     echo "unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac \
    && curl -sL "https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_TARGET}-${ZIG_VERSION}.tar.xz" \
       | tar -xJ -C /usr/local \
    && ln -s "/usr/local/zig-${ZIG_TARGET}-${ZIG_VERSION}/zig" /usr/local/bin/zig \
    && echo "${ZIG_CPU}" > /zig-cpu

WORKDIR /src

# Generate Firestore protobuf-c sources from googleapis (same as post-create.sh).
RUN PROTO_TMP=$(mktemp -d) \
    && git clone --depth=1 --filter=blob:none --sparse \
         https://github.com/googleapis/googleapis.git "$PROTO_TMP/googleapis" \
    && (cd "$PROTO_TMP/googleapis" && git sparse-checkout set \
         google/firestore/v1 google/rpc google/type google/api) \
    && mkdir -p /src/proto \
    && protoc-c \
         --proto_path="$PROTO_TMP/googleapis" \
         --proto_path=/usr/include \
         --c_out=/src/proto \
         google/api/annotations.proto \
         google/api/client.proto \
         google/api/field_behavior.proto \
         google/api/http.proto \
         google/api/launch_stage.proto \
         google/api/routing.proto \
         google/firestore/v1/aggregation_result.proto \
         google/firestore/v1/bloom_filter.proto \
         google/firestore/v1/common.proto \
         google/firestore/v1/document.proto \
         google/firestore/v1/explain_stats.proto \
         google/firestore/v1/firestore.proto \
         google/firestore/v1/pipeline.proto \
         google/firestore/v1/query.proto \
         google/firestore/v1/query_profile.proto \
         google/firestore/v1/write.proto \
         google/protobuf/any.proto \
         google/protobuf/descriptor.proto \
         google/protobuf/duration.proto \
         google/protobuf/empty.proto \
         google/protobuf/struct.proto \
         google/protobuf/timestamp.proto \
         google/protobuf/wrappers.proto \
         google/rpc/status.proto \
         google/type/latlng.proto \
    && rm -rf "$PROTO_TMP"

COPY build.zig build.zig.zon ./
COPY src ./src

# Pin -Dcpu so the binary doesn't bake in host-runner CPU features
# (e.g. AVX-512/GFNI) that Cloud Run's amd64 fleet rejects with SIGILL.
# Keep target native so zig still auto-discovers system libs under /usr.
RUN ZIG_CPU=$(cat /zig-cpu) \
    && zig build -Doptimize=ReleaseSafe -Dcpu=${ZIG_CPU} \
    && cp zig-out/bin/mocktail /mocktail

# ---- Runtime ---------------------------------------------------------------
# debian:12-slim keeps the image small while still having the shared libs
# required by libgrpc. /mocktail runs as an unprivileged user.
FROM debian:12-slim

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      libgrpc29 libprotobuf-c1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 mocktail \
    && useradd  --system --uid 10001 --gid 10001 --no-create-home mocktail

COPY --from=builder /mocktail /usr/local/bin/mocktail

ENV PORT=8080
EXPOSE 8080

USER mocktail:mocktail
ENTRYPOINT ["/usr/local/bin/mocktail"]
