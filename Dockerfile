# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
#
# The toolkit as a container: the same folder as the release zip (scripts/pack-toolkit.mjs),
# one volume for the store and the state directory. Open http://127.0.0.1:4310 and paste the
# session token from `docker compose logs`.

FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && node scripts/pack-toolkit.mjs --no-zip

FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/dist/toolkit ./
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4310
# The state directory may not lie inside the store, so both get their own folder in /data.
# Bound to all interfaces inside the container; the published port decides who can reach it.
CMD ["node", "services/api/dist/cli.js", "serve", "--init", \
     "--store", "/data/world", "--state", "/data/state", "--host", "0.0.0.0", \
     "--allow-host", "127.0.0.1", "--allow-host", "localhost", \
     "--allow-origin", "http://127.0.0.1:4310", "--allow-origin", "http://localhost:4310"]
