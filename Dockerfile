# syntax=docker/dockerfile:1
# Server image (both roles): React UI + Go server in one static binary on distroless (no shell, non-root).
# The role is chosen at run time: HLT_ROLE=monitoring (default) or HLT_ROLE=management.

FROM node:24-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN mkdir -p ../server/web/dist && npm run build

FROM golang:1.27-alpine AS server
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/server/web/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/homelab-tools . \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=server /out/homelab-tools /homelab-tools
COPY --from=server --chown=65532:65532 /out/data /data
# HLT_INSTALL=docker: the settings page shows new releases; Docker applies them (docker compose pull).
ENV HLT_ROLE=monitoring HLT_DATA_DIR=/data HLT_LISTEN=:8080 HLT_INSTALL=docker
VOLUME /data
EXPOSE 8080
USER nonroot:nonroot
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/homelab-tools", "healthcheck"]
ENTRYPOINT ["/homelab-tools"]
