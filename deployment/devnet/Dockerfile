FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203
WORKDIR /app/testing/devnet
COPY testing/devnet/package*.json ./
RUN npm ci --no-audit --no-fund
WORKDIR /app/deployment/devnet
COPY deployment/devnet/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /app/testing/devnet
COPY testing/devnet/tsconfig.json ./
COPY testing/devnet/src ./src
RUN npx tsc -p tsconfig.json
WORKDIR /app/deployment/devnet
COPY deployment/devnet/*.mjs ./
COPY sdk/idl/quorum_allocation.json /app/sdk/idl/quorum_allocation.json
USER node
CMD ["node", "producer.mjs"]
