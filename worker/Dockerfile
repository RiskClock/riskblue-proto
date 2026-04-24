FROM node:20-bookworm-slim

# @napi-rs/canvas ships prebuilt binaries for common Linux targets and does
# not require system Cairo/Pango. Just need basic CA certs.
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
