FROM evoapicloud/evolution-api:v2.3.7

# The base image currently ships Baileys 7.0.0-rc.9. The patch script refuses
# to run against another version so an upstream upgrade cannot silently use an
# incompatible textual patch.
COPY infra/evolution-api/patch-status.cjs /tmp/patch-status.cjs

RUN node /tmp/patch-status.cjs /evolution/node_modules/baileys \
  && node --check /evolution/node_modules/baileys/lib/Socket/messages-recv.js
