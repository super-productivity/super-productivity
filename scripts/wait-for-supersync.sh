#!/bin/bash
# Wait for SuperSync server to be ready at http://localhost:1901
# Checks both health endpoint AND test mode endpoint to match fixture behavior

echo "Waiting for SuperSync server on http://localhost:1901..."
echo "Checking both /health and /api/test/create-user endpoints..."

MAX_WAIT=90
elapsed=0

# Function to check if server is fully healthy (matches fixture logic)
check_server() {
  # Check 1: Basic health endpoint
  if ! curl -sf http://localhost:1901/health > /dev/null 2>&1; then
    return 1
  fi

  # Check 2: Test mode endpoint (verify TEST_MODE is enabled)
  # Create a dummy user to verify test endpoints are available
  local test_email="health-check-$(date +%s)@test.local"
  local response_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:1901/api/test/create-user \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$test_email\",\"password\":\"HealthCheck123!\"}" \
    2>/dev/null)

  # Accept 201 (created), 409 (already exists), or 400 (validation error)
  # Reject 404 (test mode disabled) or connection errors
  if [ "$response_code" = "404" ] || [ -z "$response_code" ]; then
    echo "WARNING: Health endpoint OK but test mode endpoint returned: $response_code"
    return 1
  fi

  return 0
}

until check_server; do
  if [ $elapsed -ge $MAX_WAIT ]; then
    echo ""
    echo "ERROR: SuperSync server did not start within ${MAX_WAIT}s"
    echo ""
    echo "=== Diagnostics ==="
    echo "1. Container status:"
    docker ps -a | grep -E "(supersync|db|NAMES)"
    echo ""
    echo "2. Port mappings:"
    docker ps | grep supersync | awk '{print $NF " " $(NF-1)}'
    echo ""
    echo "3. Database health:"
    docker compose -f docker-compose.e2e.yaml -f docker-compose.yaml -f docker-compose.supersync.yaml exec -T db pg_isready -U supersync 2>&1 || echo "Database not ready"
    echo ""
    echo "4. SuperSync logs (last 50 lines):"
    docker compose -f docker-compose.e2e.yaml -f docker-compose.yaml -f docker-compose.supersync.yaml logs --tail=50 supersync
    echo ""
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
  # Show progress every 10 seconds
  if [ $((elapsed % 10)) -eq 0 ]; then
    echo "Still waiting... (${elapsed}s / ${MAX_WAIT}s)"
  fi
done

echo "SuperSync server is ready! (Both health and test endpoints responding)"
