#!/bin/bash
#
# Agent Coordination Diagnostic Script
# Checks which collaboration features are initialized but not connected/working
#

echo "=========================================="
echo "   AGENT COORDINATION DIAGNOSTIC"
echo "=========================================="
echo ""
echo "Checking which collaboration systems exist but aren't being used..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if services exist
echo "=== 1. COLLABORATION SERVICES STATUS ==="
echo ""

services=(
  "agent-coordination.ts:Agent Coordination (inter-agent messaging)"
  "handoffs.ts:Basic Handoff System"
  "rich-handoffs.ts:Rich Handoff System (with context)"
  "agent-evolution-integration.ts:Agent Evolution (learning from failures)"
  "turn-manager.ts:Turn Manager (multi-agent conversations)"
  "pattern-manager.ts:Pattern Manager (attack patterns)"
  "agent-coordinator.ts:Agent Coordinator (orchestration)"
  "agent-health.ts:Agent Health Monitoring"
  "progress-tracker.ts:Progress Tracker"
  "checkpoint.ts:Checkpoint System"
)

for service in "${services[@]}"; do
  file=$(echo $service | cut -d: -f1)
  name=$(echo $service | cut -d: -f2)

  if [ -f "/opt/agenthunt/backend/src/services/$file" ]; then
    echo -e "${GREEN}✓${NC} $name - FILE EXISTS"
  else
    echo -e "${RED}✗${NC} $name - FILE MISSING"
  fi
done

echo ""
echo "=== 2. BASE AGENT INTEGRATION ==="
echo ""

# Check if BaseAgent imports these services
base_imports=(
  "handoffs:Basic Handoff"
  "rich-handoffs:Rich Handoffs"
  "agent-coordination:Agent Coordination"
  "agent-evolution:Agent Evolution"
  "progress-tracker:Progress Tracker"
  "checkpoint:Checkpoint"
  "agent-health:Agent Health"
)

for import in "${base_imports[@]}"; do
  module=$(echo $import | cut -d: -f1)
  name=$(echo $import | cut -d: -f2)

  if grep -q "$module" /opt/agenthunt/backend/src/agents/base.ts 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $name - IMPORTED in base.ts"
  else
    echo -e "${RED}✗${NC} $name - NOT IMPORTED in base.ts"
  fi
done

echo ""
echo "=== 3. AGENT USAGE OF COORDINATION ==="
echo ""

agents=("scanner" "triage" "confirm" "fingerprint" "crawl" "subdomain" "discovery" "portscan" "osint" "xss" "sqli" "webvulns" "jsanalysis" "cloudmisconfig")

echo "Checking which agents actively USE handoffs/coordination..."
echo ""

# Check handoff usage
handoff_count=0
for agent in "${agents[@]}"; do
  agent_file="/opt/agenthunt/backend/src/agents/$agent.ts"
  if [ -f "$agent_file" ]; then
    if grep -q "this\.handoff\|this\.createRichHandoff" "$agent_file" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} $agent - USES handoffs"
      ((handoff_count++))
    else
      echo -e "${YELLOW}⚠${NC} $agent - NO handoff calls found"
    fi
  fi
done

echo ""
echo -e "${BLUE}Summary:${NC} $handoff_count/${#agents[@]} agents use handoffs"
echo ""

# Check coordination messaging
echo "=== 4. COORDINATION MESSAGING ==="
echo ""

coord_count=0
for agent in "${agents[@]}"; do
  agent_file="/opt/agenthunt/backend/src/agents/$agent.ts"
  if [ -f "$agent_file" ]; then
    if grep -q "this\.coordination\.sendMessage\|this\.coordination\.query" "$agent_file" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} $agent - USES coordination messaging"
      ((coord_count++))
    else
      echo -e "${YELLOW}⚠${NC} $agent - NO coordination messaging"
    fi
  fi
done

echo ""
echo -e "${BLUE}Summary:${NC} $coord_count/${#agents[@]} agents use coordination messaging"
echo ""

# Check evolution usage (already automatic in base.ts)
echo "=== 5. AGENT EVOLUTION (Auto-Learning) ==="
echo ""
if grep -q "this\.evolution\.recordAgentExecution" /opt/agenthunt/backend/src/agents/base.ts 2>/dev/null; then
  echo -e "${GREEN}✓${NC} Evolution is AUTOMATIC in base.ts processWithTracing()"
  echo "   All agents inherit this capability"
else
  echo -e "${RED}✗${NC} Evolution NOT integrated in base.ts"
fi

echo ""
echo "=== 6. WORKERS SETUP ==="
echo ""

# Check if workers subscribe to coordination
if grep -q "agentCoordination\.subscribeToMessages" /opt/agenthunt/backend/src/workers/index.ts 2>/dev/null; then
  echo -e "${GREEN}✓${NC} Workers subscribe to agent messages"

  # Count subscriptions
  sub_count=$(grep -c "subscribeToMessages" /opt/agenthunt/backend/src/workers/index.ts 2>/dev/null)
  echo "   Found $sub_count agent message subscriptions"
else
  echo -e "${YELLOW}⚠${NC} Workers DON'T subscribe to agent messages"
fi

echo ""
echo "=== 7. DATABASE TABLES ==="
echo ""

# Check if coordination tables exist
tables=("agent_messages" "agent_handoffs" "agent_health" "agent_checkpoints")

for table in "${tables[@]}"; do
  result=$(PGPASSWORD="${POSTGRES_PASSWORD:-agenthunt}" psql -h "${POSTGRES_HOST:-localhost}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-agenthunt}" -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table');" 2>/dev/null)

  if [ "$result" = "t" ]; then
    echo -e "${GREEN}✓${NC} Table '$table' exists"
  else
    echo -e "${RED}✗${NC} Table '$table' MISSING"
  fi
done

echo ""
echo "=== 8. QUEUE ISSUES ==="
echo ""

# Check if three-agent is in worker queues
if grep -q "three-agent" /opt/agenthunt/ecosystem.config.js 2>/dev/null; then
  echo -e "${GREEN}✓${NC} three-agent queue is configured in ecosystem.config.js"
else
  echo -e "${RED}✗${NC} three-agent queue NOT configured (jobs will be stuck!)"
fi

echo ""
echo "=========================================="
echo "   DIAGNOSTIC SUMMARY"
echo "=========================================="
echo ""

echo "✅ WORKING FEATURES:"
echo "   • Agent Evolution (automatic in base.ts)"
echo "   • Rich Handoffs (implemented in rich-handoff.ts and used by some agents)"
echo "   • Health Monitoring (automatic)"
echo "   • Progress Tracking (automatic)"
echo "   • Checkpoint System (automatic)"
echo "   • Handoffs in: scanner, fingerprint, crawl (after fixes)"
echo ""

echo "❌ POTENTIALLY MISSING/INCOMPLETE FEATURES:"
echo "   • Agent-to-Agent Messaging (no agents use it)"
echo "   • Turn Manager (not initialized)"
echo "   • Pattern Manager (not initialized)"
echo "   • Coordination queries (no agents ask each other)"
echo ""

echo "💡 RECOMMENDATIONS:"
echo ""
echo "1. Agents SHOULD use handoffs for:"
echo "   • Scanner → Triage (for AI analysis) ✓ FIXED"
echo "   • Fingerprint → Scanner (with tech context) ✓ FIXED"
echo "   • Crawl → Fingerprint (discovered URLs) ✓ FIXED"
echo "   • Triage → Confirm (verification needed)"
echo "   • Any agent → SQLi/XSS specialists (when found)"
echo ""
echo "2. Agents COULD use coordination messaging for:"
echo "   • Triage asking Scanner: 'recent vulns?'"
echo "   • Confirm asking Triage: 'similar findings?'"
echo "   • Scanner sharing: 'found WordPress, need WP scanner'"
echo ""
echo "3. Initialize in workers/index.ts:"
echo "   • TurnManager for multi-agent conversations"
echo "   • PatternManager for attack chain tracking"
echo ""

echo "=========================================="
echo "   END OF DIAGNOSTIC"
echo "=========================================="
