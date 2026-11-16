FROM node:22-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 10000
CMD ["node", "--use-system-ca", "server/index.js"]
