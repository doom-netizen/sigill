# Sigil for Render: the whole source is in sigil-src.tar.gz (one file, so it's
# easy to upload to GitHub from the browser). This unpacks it and builds.
FROM node:22-bookworm-slim AS src
WORKDIR /src
COPY sigil-src.tar.gz /tmp/src.tgz
RUN tar -xzf /tmp/src.tgz -C /src && ls /src

FROM node:22-bookworm-slim AS web
WORKDIR /src/app
# The web build only needs esbuild and React.
RUN npm init -y >/dev/null && npm install --no-audit --no-fund esbuild@0.24 react@19 react-dom@19
WORKDIR /src
COPY --from=src /src/shared ./shared
COPY --from=src /src/app/build.mjs ./app/build.mjs
COPY --from=src /src/app/src ./app/src
RUN cd app && node build.mjs --prod --only=web

FROM node:22-bookworm-slim
WORKDIR /srv/sigil
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data WEB_DIR=/srv/sigil/app/dist/web
COPY --from=src /src/shared ./shared
COPY --from=src /src/server/package.json ./server/package.json
RUN cd server && npm install --include=dev --no-audit --no-fund
COPY --from=src /src/server ./server
COPY --from=web /src/app/dist/web ./app/dist/web
EXPOSE 8787
WORKDIR /srv/sigil/server
CMD ["npx", "tsx", "src/index.ts"]
