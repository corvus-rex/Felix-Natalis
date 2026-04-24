FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ---- API ----
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=base /app /app

CMD ["node", "dist/main.js"]