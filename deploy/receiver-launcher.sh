#!/bin/sh
set -eu
# Installed root-owned; this account has no general SSH shell or forwarding.
exec /usr/bin/env -i PATH=/usr/bin:/bin SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}" \
  /usr/bin/flock --exclusive --timeout 900 /var/lib/zsvirt-docs-deploy/deploy.lock \
  /usr/bin/timeout --signal=TERM --kill-after=60 1800 \
  /usr/bin/node /usr/local/lib/zsvirt-docs-deploy/receiver.mjs
