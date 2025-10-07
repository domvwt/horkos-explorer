#!/bin/bash
set -e

# Horkos Explorer Development Server Startup Script

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Show help
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Horkos Explorer Development Server"
    echo ""
    echo "Usage:"
    echo "  $0 /path/to/database.kuzu"
    echo "  $0  # Uses KUZU_DIR and KUZU_FILE env vars"
    echo ""
    echo "Example:"
    echo "  $0 ../horkos/data/horkos_dev_pl_graph.kuzu"
    echo ""
    echo "Environment variables (optional):"
    echo "  MODE                  Access mode (default: READ_ONLY)"
    echo "  KUZU_QUERY_TIMEOUT    Query timeout in ms (default: 30000)"
    exit 0
fi

# Parse database path argument
if [ -n "$1" ]; then
    DB_PATH="$1"
    if [ ! -f "$DB_PATH" ]; then
        echo -e "${RED}Error: Database file not found: $DB_PATH${NC}"
        exit 1
    fi
    export KUZU_DIR="$(dirname "$DB_PATH")"
    export KUZU_FILE="$(basename "$DB_PATH")"
    echo -e "${GREEN}Using database: $DB_PATH${NC}"
else
    # Use defaults if no argument provided
    if [ -z "$KUZU_DIR" ] || [ -z "$KUZU_FILE" ]; then
        echo -e "${YELLOW}Warning: No database path provided and KUZU_DIR/KUZU_FILE not set${NC}"
        echo "Usage: $0 /path/to/database.kuzu"
        echo "   OR: Set KUZU_DIR and KUZU_FILE environment variables"
        exit 1
    fi
    echo -e "${GREEN}Using database: $KUZU_DIR/$KUZU_FILE${NC}"
fi

# Set Java environment
if [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo -e "${GREEN}✓ Java 21 configured${NC}"
else
    echo -e "${YELLOW}Warning: Java 21 not found at expected path${NC}"
    echo "Grammar generation may fail. Install Java 21 or set JAVA_HOME manually."
fi

# Switch to Node.js v20 if nvm is available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use 20 > /dev/null 2>&1 || {
        echo -e "${YELLOW}Warning: Node.js v20 not installed via nvm${NC}"
        echo "Installing Node.js v20..."
        nvm install 20
        nvm use 20
    }
    echo -e "${GREEN}✓ Node.js v$(node --version) active${NC}"
else
    echo -e "${YELLOW}Warning: nvm not found. Ensure Node.js v20 is active.${NC}"
fi

# Set read-only mode by default
export MODE="${MODE:-READ_ONLY}"
echo -e "${GREEN}✓ Access mode: $MODE${NC}"

# Optional: Set query timeout (30 seconds)
export KUZU_QUERY_TIMEOUT="${KUZU_QUERY_TIMEOUT:-30000}"

echo ""
echo -e "${GREEN}Starting Horkos Explorer...${NC}"
echo "Server will be available at: http://localhost:8080/"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start the development server
npm run serve
