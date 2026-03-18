FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=14702

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 14702
CMD ["npm", "start"]
