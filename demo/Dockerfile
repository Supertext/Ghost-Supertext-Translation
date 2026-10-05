# Ghost 6 + Supertext connector demo. Build context: repository root.
#   docker build -f demo/Dockerfile -t ghost-supertext-demo .
FROM ghost:6 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ghost:6

# Ghost listens only inside the container; the connector is the public entry point.
# SQLite keeps the demo to one service with one volume (mount it at /var/lib/ghost/content).
# Staff device verification e-mails a code on every new login; the demo sends no mail, so it is off.
# Mail goes to 127.0.0.1:2525, where the bootstrap listens only while it creates the editor account.
ENV NODE_ENV=production \
    server__host=127.0.0.1 \
    server__port=2368 \
    database__client=sqlite3 \
    database__connection__filename=/var/lib/ghost/content/data/ghost.db \
    database__useNullAsDefault=true \
    security__staffDeviceVerification=false \
    mail__transport=SMTP \
    mail__from=noreply@demo.supertext.invalid \
    mail__options__host=127.0.0.1 \
    mail__options__port=2525 \
    mail__options__secure=false \
    mail__options__ignoreTLS=true \
    logging__transports='["stdout"]' \
    SOURCE_LANGUAGE=en \
    TARGET_LANGUAGES=de-CH,fr-CH \
    SUPERTEXT_POLITENESS=more

COPY --from=build /app/dist /opt/supertext/dist
COPY --from=build /app/node_modules /opt/supertext/node_modules
COPY --from=build /app/package.json /opt/supertext/package.json
COPY demo/bootstrap.mjs demo/sample-post.html demo/entrypoint.sh /opt/supertext/demo/
RUN chmod +x /opt/supertext/demo/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/opt/supertext/demo/entrypoint.sh"]
