FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Set AFTER the build: vite and @vitejs/plugin-react are devDependencies, and
# npm ci skips those when NODE_ENV=production is already set — "vite: not
# found" at the build step above. Runtime still gets production behaviour.
ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 10000
CMD ["node", "--use-system-ca", "server/index.js"]
