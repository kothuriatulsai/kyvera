FROM node:22-alpine

WORKDIR /app

# Full source for every workspace this image needs, copied before `npm
# install` - not just each package.json. Both apps/api's own postinstall
# (`prisma generate`, which needs schema.prisma) and packages/shared-types'
# (`tsc`, which needs its src/ and tsconfig.json) run DURING `npm install`
# and need their real source already present, not just a bare package.json -
# copying package.json alone first, for the usual Docker layer-caching
# pattern, silently broke both.
COPY package.json package-lock.json* ./
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types

RUN npm install

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["npm", "run", "dev"]
