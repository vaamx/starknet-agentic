FROM node:22-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY package.json ./
RUN pnpm install --prod

COPY dist/ ./dist/

# SQLite data volume
VOLUME ["/app/data"]

ENV DATABASE_URL=/app/data/bitsage.db
EXPOSE 8080

CMD ["node", "dist/index.js"]
