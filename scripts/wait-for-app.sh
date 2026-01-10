#!/bin/bash
# Wait for the Angular dev server to be ready

PORT=${APP_PORT:-4242}
MAX_WAIT=${MAX_WAIT:-180}
INTERVAL=2

echo "Waiting for app on port $PORT (max ${MAX_WAIT}s)..."

elapsed=0
until curl -sf "http://localhost:$PORT" > /dev/null 2>&1; do
  if [ $elapsed -ge $MAX_WAIT ]; then
    echo "Timeout: App did not start within ${MAX_WAIT}s"
    exit 1
  fi
  sleep $INTERVAL
  elapsed=$((elapsed + INTERVAL))
  echo "  Still waiting... (${elapsed}s)"
done

echo "App is ready on port $PORT!"
