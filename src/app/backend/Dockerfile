# vLEI linkage verifier backend
# built from project root -- needs workspace packages
FROM node:20-alpine

# native module build deps
RUN apk add --no-cache python3 make g++

WORKDIR /app

# workspace config
COPY package.json ./

# workspace package.json files
COPY src/packages/gleif-verifier-core/package.json ./src/packages/gleif-verifier-core/
COPY src/packages/gleif-verifier-node/package.json ./src/packages/gleif-verifier-node/
COPY src/app/backend/package.json ./src/app/backend/
COPY src/app/frontend/package.json ./src/app/frontend/

# install deps
RUN npm install

# workspace package sources
COPY src/packages/ ./src/packages/

# backend source
COPY src/app/backend/ ./src/app/backend/

# build workspace packages first, then backend
WORKDIR /app/src/packages/gleif-verifier-core
RUN npm run build

WORKDIR /app/src/packages/gleif-verifier-node
RUN npm run build

# tsc directly -- ts-patch doesn't work well in containers
WORKDIR /app/src/app/backend
RUN ./node_modules/.bin/tsc || npx tsc

EXPOSE 3000

CMD ["node", "dist/index.js"]
