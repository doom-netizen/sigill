# Sigil: one container with the server, the web app at /app/, and public profiles at /{username}.
#   docker build -t sigil .
#   docker run -p 8787:8787 -v sigil-data:/data -e FINGERPRINT_SECRET=$(openssl rand -hex 32) -e PUBLIC_ORIGIN=https://your.domain sigil
FROM node:22-bookworm-slim AS web
WORKDIR /src/app
# The web build only needs esbuild and React (not Electron or the test tools).
RUN npm init -y >/dev/null && npm install --no-audit --no-fund esbuild@0.24 react@19 react-dom@19
WORKDIR /src
COPY shared ./shared
COPY app/build.mjs ./app/build.mjs
COPY app/src ./app/src
RUN cd app && node build.mjs --prod --only=web

FROM node:22-bookworm-slim
WORKDIR /srv/sigil
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data WEB_DIR=/srv/sigil/app/dist/web
COPY shared ./shared
COPY server/package*.json ./server/
RUN cd server && npm install --include=dev --no-audit --no-fund
COPY server ./server
COPY --from=web /src/app/dist/web ./app/dist/web
EXPOSE 8787
WORKDIR /srv/sigil/server
CMD ["npx", "tsx", "src/index.ts"]
