#!/bin/bash

# Wait for WebDAV server to be ready
# Retries for up to 60 seconds
# authenticates as admin:admin to ensure we get a 200/2xx response, not 401

echo "Waiting for WebDAV server on http://127.0.0.1:2345..."

for i in {1..60}; do
  if curl -u admin:admin --silent --output /dev/null --fail http://127.0.0.1:2345; then
    echo "WebDAV server is up!"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Timeout waiting for WebDAV server."
    docker compose logs webdav-e2e
    exit 1
  fi
  sleep 1
done

# Concurrent-upload tests assume the server rejects stale writes. A server that
# ignores If-Match lets them lose data intermittently instead of failing (#10590).
PROBE_URL="http://127.0.0.1:2345/.cas-probe-$$"
put_status() {
  curl -u admin:admin --silent --output /dev/null --write-out '%{http_code}' \
    -X PUT --data probe "$@" "$PROBE_URL"
}
CREATE=$(put_status)
STALE_IF_MATCH=$(put_status -H 'If-Match: "stale-probe"')
IF_NONE_MATCH=$(put_status -H 'If-None-Match: *')
curl -u admin:admin --silent --output /dev/null -X DELETE "$PROBE_URL"

if [ "$CREATE" != "201" ] || [ "$STALE_IF_MATCH" != "412" ] || [ "$IF_NONE_MATCH" != "412" ]; then
  echo "WebDAV server does not enforce write preconditions" \
    "(create=$CREATE, stale If-Match=$STALE_IF_MATCH, If-None-Match *=$IF_NONE_MATCH; want 201/412/412)."
  echo "Start the E2E server with: docker compose up -d --build webdav-e2e"
  exit 1
fi
echo "WebDAV server enforces If-Match and If-None-Match."
