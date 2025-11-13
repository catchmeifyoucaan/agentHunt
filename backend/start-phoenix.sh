#!/bin/bash
# Phoenix Observability Server
# Starts Phoenix on 0.0.0.0:6006 for external access

export PHOENIX_HOST=0.0.0.0
export PHOENIX_PORT=6006
export PHOENIX_WORKING_DIR=/opt/agenthunt/phoenix-data

# Create working directory if it doesn't exist
mkdir -p "$PHOENIX_WORKING_DIR"

# Start Phoenix server
exec python3 -m phoenix.server.main serve
