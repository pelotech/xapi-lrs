FROM docker.io/node:24.13-alpine

RUN apk update && apk upgrade --no-cache
RUN npm install -g npm@latest

LABEL vendor="Pelotech"

HEALTHCHECK --interval=300s --timeout=12s --start-period=30s \
  CMD node -e "fetch('http://localhost:8190/healthz').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

RUN addgroup --system lrs --gid 1001 && \
    adduser --system -G lrs lrs

WORKDIR /app
RUN chown lrs:lrs /app
USER lrs

EXPOSE 8180 8190

COPY --chown=lrs:lrs "./node_modules" "/app/node_modules"
COPY --chown=lrs:lrs "./package.json" "/app/package.json"
COPY --chown=lrs:lrs "./main.js" "/app/dist/main.js"

ARG APP_VERSION=local
ENV APP_VERSION=${APP_VERSION}

CMD ["node", "."]
