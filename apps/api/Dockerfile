FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm install

COPY apps/api apps/api
COPY packages/shared-types packages/shared-types

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["npm", "run", "dev"]
