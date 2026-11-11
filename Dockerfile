FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY certs ./certs

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- --no-check-certificate https://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server/index.js"]
