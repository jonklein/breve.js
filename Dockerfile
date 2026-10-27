# syntax=docker/dockerfile:1
# The workbench is a static site: build it with Node, serve the result with nginx.

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci
COPY blog ./blog
COPY examples ./examples
COPY scripts ./scripts
COPY tsconfig.base.json ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/workbench/dist /usr/share/nginx/html
# listens on 8080 (see fly.toml) and runs as the unprivileged nginx user
