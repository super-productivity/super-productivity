#!/bin/bash
# Discover actual Docker container and volume names for this deployment
# This helps adapt the generic plan to your specific setup

echo "=== Docker Service Discovery ==="
echo ""

# Check if docker-compose.yml exists
if [ ! -f "docker-compose.yml" ]; then
  echo "⚠️  WARNING: docker-compose.yml not found in current directory"
  echo "   Run this script from the super-sync-server directory"
  echo ""
fi

echo "1. Docker Compose Service Names"
echo "   (PostgreSQL/database services):"
echo "   --------------------------------"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose config --services 2>/dev/null | grep -E 'db|postgres' || echo "   No matching services found"
else
  echo "   ERROR: docker compose not available"
fi

echo ""
echo "2. PostgreSQL Volume Names"
echo "   (Docker volumes for database data):"
echo "   ------------------------------------"
if command -v docker >/dev/null 2>&1; then
  docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E 'db_data|pg' || echo "   No matching volumes found"
else
  echo "   ERROR: docker not available"
fi

echo ""
echo "3. Volume Mount Paths"
echo "   (Actual filesystem paths):"
echo "   --------------------------"
if command -v docker >/dev/null 2>&1; then
  VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep -E 'db_data|pg' | head -1)
  if [ -n "$VOLUME_NAME" ]; then
    echo "   Volume: $VOLUME_NAME"
    docker volume inspect "$VOLUME_NAME" --format '   Path: {{.Mountpoint}}' 2>/dev/null || echo "   ERROR: Cannot inspect volume"
  else
    echo "   No volumes found"
  fi
else
  echo "   ERROR: docker not available"
fi

echo ""
echo "4. Running Container Names"
echo "   (Currently active containers):"
echo "   ------------------------------"
if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'db|postgres' || echo "   No matching containers running"
else
  echo "   ERROR: docker not available"
fi

echo ""
echo "========================================"
echo "Usage in scripts:"
echo "========================================"
echo ""
echo "Replace these example names with your actual names:"
echo ""
echo "Example → Your Deployment"
echo "------------------------------------------------------------------------------"
echo "supersync-postgres  → [your service/container name from section 1 or 4]"
echo "supersync_pg-data   → [your volume name from section 2]"
echo "/var/lib/docker/volumes/supersync_pg-data/_data → [path from section 3]"
echo ""
echo "Example substitution:"
echo "  # Plan says:"
echo "  docker exec supersync-postgres pg_dump ..."
echo ""
echo "  # You run (if your service is 'db'):"
echo "  docker exec db pg_dump ..."
echo ""
