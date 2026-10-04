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

# `.env` is excluded from the build context (.dockerignore) - a real one,
# with real secrets, must never end up baked into an image layer. `prisma
# generate` (apps/api's postinstall) still needs *a* DATABASE_URL to load
# prisma.config.ts, though - it only reads the schema, it doesn't connect -
# so this placeholder is scoped to just this one instruction, never the image
# itself; the real value comes from docker-compose.yml at container run time.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public" npm install

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["npm", "run", "dev"]
