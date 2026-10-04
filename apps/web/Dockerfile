FROM node:22-alpine

WORKDIR /app

# Full source for every workspace this image needs, copied before `npm
# install` - not just each package.json. packages/shared-types' postinstall
# (`tsc`) runs DURING `npm install` and needs its real src/tsconfig.json
# already present, not just a bare package.json; copying package.json alone
# first, for the usual Docker layer-caching pattern, silently broke it (same
# issue fixed in apps/api/Dockerfile).
COPY package.json package-lock.json* ./
COPY apps/web apps/web
COPY packages/shared-types packages/shared-types

RUN npm install

WORKDIR /app/apps/web

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
