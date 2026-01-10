#!/bin/bash

# Wait for WebDAV server to be ready
# Retries for up to 60 seconds
# authenticates as admin:admin to ensure we get a 200/2xx response, not 401

echo "Waiting for WebDAV server on http://127.0.0.1:2345..."

for i in {1..60}; do
  if curl -u admin:admin --silent --output /dev/null --fail http://127.0.0.1:2345; then
    echo "WebDAV server is up!"
    exit 0
  fi
  sleep 1
done

echo "Timeout waiting for WebDAV server."
docker compose logs webdav
exit 1
