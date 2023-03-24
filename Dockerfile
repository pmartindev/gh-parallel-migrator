FROM node:18-alpine as base

ENV NODE_ENV=production

WORKDIR /app

RUN apk update \
    && apk add --no-cache python3

COPY package*.json ./

RUN --mount=type=cache,target=/app/.npm \
    npm set cache /app.npm && \
    npm ci --only=production

USER node

COPY --chown=node:node ./dist ./dist
COPY --chown=node:node ./src ./src
COPY --chown=node:node ./tsconfig.json .

RUN npm run build

ENTRYPOINT [ "node", "dist/main.js" ]
CMD [ "" ]