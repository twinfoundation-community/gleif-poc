# vLEI linkage verifier backend
# built from project root -- needs workspace packages
FROM node:20-alpine

# native module build deps
RUN apk add --no-cache python3 make g++

WORKDIR /app

# workspace config, lockfile, npm settings
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# workspace package.json files
COPY src/packages/gleif-verifier-core/package.json ./src/packages/gleif-verifier-core/
COPY src/packages/gleif-verifier-node/package.json ./src/packages/gleif-verifier-node/
COPY src/app/backend/package.json ./src/app/backend/

# install pnpm and deps
RUN npm install -g pnpm && pnpm install

# workspace package sources
COPY src/packages/ ./src/packages/

# backend source
COPY src/app/backend/ ./src/app/backend/

# build workspace packages first, then backend
WORKDIR /app/src/packages/gleif-verifier-core
RUN pnpm build

WORKDIR /app/src/packages/gleif-verifier-node
RUN pnpm build

# tsc directly -- ts-patch doesn't work well in containers
WORKDIR /app/src/app/backend
RUN ./node_modules/.bin/tsc || pnpm exec tsc

EXPOSE 3000

CMD ["node", "dist/index.js"]
