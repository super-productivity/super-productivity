#!/bin/bash
# SuperSync Production Monitoring Wrapper
#
# Usage:
#   ./scripts/docker-monitor.sh stats
#   ./scripts/docker-monitor.sh usage
#   ./scripts/docker-monitor.sh ops --user 29
#   ./scripts/docker-monitor.sh analyze operation-sizes --user 29
#   ./scripts/docker-monitor.sh analyze user-deep-dive --user 27
#   ./scripts/docker-monitor.sh monitor-all
#   ./scripts/docker-monitor.sh monitor-all --save

set -e

CONTAINER_NAME="${SUPERSYNC_CONTAINER:-supersync-server}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${RED}Error: Container '${CONTAINER_NAME}' is not running${NC}"
  echo "Available containers:"
  docker ps --format "table {{.Names}}\t{{.Status}}"
  echo ""
  echo "Set custom container name: export SUPERSYNC_CONTAINER=your-container-name"
  exit 1
fi

echo -e "${GREEN}→ Running on container: ${CONTAINER_NAME}${NC}\n"

# Parse command
COMMAND=$1
shift || true

case "$COMMAND" in
  # Basic monitoring commands (compiled scripts)
  stats|usage|usage-history|logs|ops)
    echo -e "${YELLOW}Running: monitor.js $COMMAND $@${NC}"
    docker exec -it "$CONTAINER_NAME" node dist/scripts/monitor.js "$COMMAND" "$@"
    ;;

  # Analysis commands (need TypeScript - use npx tsx)
  analyze)
    SUBCOMMAND=$1
    shift || true

    echo -e "${YELLOW}Running: analyze-storage.ts $SUBCOMMAND $@${NC}"

    # Check if tsx is available, if not use npx or install
    if docker exec "$CONTAINER_NAME" sh -c "command -v tsx >/dev/null 2>&1"; then
      # tsx already installed
      docker exec -it "$CONTAINER_NAME" tsx scripts/analyze-storage.ts "$SUBCOMMAND" "$@"
    else
      # Try npx first (faster, no installation needed)
      echo -e "${YELLOW}Using npx tsx (first time may be slower)...${NC}"
      docker exec -it "$CONTAINER_NAME" npx tsx scripts/analyze-storage.ts "$SUBCOMMAND" "$@"
    fi
    ;;

  # Full monitoring suite
  monitor-all|all)
    echo -e "${YELLOW}Running: Full monitoring suite${NC}"

    # Check if tsx is available, if not use npx
    if docker exec "$CONTAINER_NAME" sh -c "command -v tsx >/dev/null 2>&1"; then
      docker exec -it "$CONTAINER_NAME" tsx scripts/run-all-monitoring.ts "$@"
    else
      echo -e "${YELLOW}Using npx tsx (first time may be slower)...${NC}"
      docker exec -it "$CONTAINER_NAME" npx tsx scripts/run-all-monitoring.ts "$@"
    fi
    ;;

  # Interactive shell
  shell|bash|sh)
    echo -e "${YELLOW}Opening shell in container...${NC}"
    docker exec -it "$CONTAINER_NAME" sh
    ;;

  # Copy reports out of container
  get-reports)
    DEST="${1:-.}"
    echo -e "${YELLOW}Copying monitoring reports from container...${NC}"
    docker cp "$CONTAINER_NAME:/app/monitoring-reports" "$DEST/" 2>/dev/null || \
      echo -e "${RED}No reports found. Run 'monitor-all --save' first.${NC}"
    docker cp "$CONTAINER_NAME:/app/analysis-output" "$DEST/" 2>/dev/null || \
      echo -e "${YELLOW}No analysis outputs found.${NC}"
    docker cp "$CONTAINER_NAME:/app/logs/usage-history.jsonl" "$DEST/" 2>/dev/null || \
      echo -e "${YELLOW}No usage history found.${NC}"
    echo -e "${GREEN}Done! Reports copied to: $DEST${NC}"
    ;;

  # Help
  help|--help|-h|"")
    cat << 'EOF'
SuperSync Production Monitoring Wrapper

Usage:
  ./scripts/docker-monitor.sh <command> [options]

Basic Monitoring (uses compiled scripts):
  stats                         System vitals and DB status
  usage                         Top 20 users by storage
  usage-history [--tail N]      View usage trends
  ops [--user ID] [--tail N]    Recent operations analysis
  logs [--tail N] [--search X]  View server logs

Analysis (uses TypeScript - auto-installs tsx):
  analyze operation-sizes [--user ID]       Operation size distribution
  analyze operation-timeline [--user ID]    Temporal patterns
  analyze operation-types [--user ID]       Breakdown by type
  analyze large-ops [--limit N]             Find largest operations
  analyze rapid-fire [--threshold N]        Detect sync loops
  analyze snapshot-analysis                 Snapshot patterns
  analyze user-deep-dive --user ID          Complete user analysis
  analyze export-ops --user ID [--limit N]  Export to JSON
  analyze compare-users ID1 ID2             Compare two users

Complete Suite:
  monitor-all                   Run all monitoring checks
  monitor-all --quick           Quick mode (skip deep analysis)
  monitor-all --save            Save to timestamped file
  monitor-all --user ID         Focus on specific user

Utilities:
  shell                         Open interactive shell in container
  get-reports [destination]     Copy reports from container to host

Environment Variables:
  SUPERSYNC_CONTAINER          Container name (default: supersync-server)

Examples:
  ./scripts/docker-monitor.sh usage
  ./scripts/docker-monitor.sh analyze user-deep-dive --user 29
  ./scripts/docker-monitor.sh monitor-all --save
  ./scripts/docker-monitor.sh get-reports ./reports

For detailed documentation, see scripts/MONITORING-README.md
EOF
    ;;

  *)
    echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
    echo "Run './scripts/docker-monitor.sh help' for usage"
    exit 1
    ;;
esac
