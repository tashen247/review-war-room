FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
ENV DB_PATH=/app/data/warroom.db
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
