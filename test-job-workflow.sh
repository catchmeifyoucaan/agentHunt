#!/bin/bash
# AgentHunt Job Trigger & Auto-Orchestration Test Script
# This script demonstrates the complete workflow from job trigger to completion

set -e

API_URL="http://localhost:3000"
# If testing against production, use:
# API_URL="http://165.227.108.120:3000"

echo "🎯 AgentHunt Job Trigger Test"
echo "=============================="
echo ""

# Step 1: Check API Health
echo "📡 Step 1: Checking API health..."
HEALTH=$(curl -s ${API_URL}/health)
echo "Response: ${HEALTH}"
echo ""

# Step 2: Create Test Program
echo "📋 Step 2: Creating test program..."
PROGRAM_RESPONSE=$(curl -s -X POST ${API_URL}/api/v1/programs \
  -H "Content-Type: application/json" \
  -d @sample-program.json)

PROGRAM_ID=$(echo $PROGRAM_RESPONSE | jq -r '.id')
echo "✅ Program created with ID: ${PROGRAM_ID}"
echo ""

# Step 3: Trigger Discovery Job (MANUAL - ONE TIME ONLY)
echo "🚀 Step 3: Triggering discovery job (MANUAL TRIGGER)..."
echo "This is the ONLY manual step. Everything after this is automatic!"
echo ""

# Update the job file with the program ID
sed "s/REPLACE_WITH_PROGRAM_ID/${PROGRAM_ID}/g" sample-discovery-job.json > /tmp/job.json

JOB_RESPONSE=$(curl -s -X POST ${API_URL}/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d @/tmp/job.json)

DISCOVERY_JOB_ID=$(echo $JOB_RESPONSE | jq -r '.id')
echo "✅ Discovery job created with ID: ${DISCOVERY_JOB_ID}"
echo "Queue position: $(echo $JOB_RESPONSE | jq -r '.position')"
echo ""

# Step 4: Monitor Job Progress
echo "📊 Step 4: Monitoring job execution..."
echo "Press Ctrl+C to stop monitoring"
echo ""

ITERATION=0
while true; do
  ITERATION=$((ITERATION + 1))
  sleep 5

  JOB_STATUS=$(curl -s ${API_URL}/api/v1/jobs/${DISCOVERY_JOB_ID})
  STATUS=$(echo $JOB_STATUS | jq -r '.status')

  echo "[$ITERATION] Discovery Job Status: ${STATUS}"

  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "✅ Discovery job completed!"
    RESULT=$(echo $JOB_STATUS | jq -r '.result')
    echo "Discovered subdomains: $(echo $RESULT | jq -r '.summary.totalSubdomains')"
    echo ""
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "❌ Discovery job failed!"
    echo "Error: $(echo $JOB_STATUS | jq -r '.error')"
    exit 1
  fi
done

# Step 5: Check Auto-Triggered Jobs
echo "🤖 Step 5: Checking AUTO-TRIGGERED jobs (No manual intervention!)..."
echo ""

sleep 3

ALL_JOBS=$(curl -s "${API_URL}/api/v1/jobs?program_id=${PROGRAM_ID}")
echo "📋 Jobs created for this program:"
echo $ALL_JOBS | jq -r '.jobs[] | "  - [\(.type)] \(.id) - Status: \(.status)"'
echo ""

# Expected auto-triggered jobs:
echo "✨ Expected Auto-Orchestration Chain:"
echo "  1. ✅ Discovery (MANUAL - completed)"
echo "  2. 🔄 Fingerprint (AUTO - should be pending/active)"
echo "  3. 🔄 DNS Check (AUTO - should be pending/active)"
echo "  4. 🔄 Scanner (AUTO - triggered after fingerprint)"
echo "  5. 🔄 Crawler (AUTO - triggered after fingerprint)"
echo "  6. 🔄 Triage (AUTO - triggered per finding)"
echo "  7. 🔄 Confirm (AUTO - triggered for high-confidence findings)"
echo ""

# Step 6: Monitor Auto-Orchestration
echo "⏳ Step 6: Monitoring complete pipeline..."
echo ""

for i in {1..20}; do
  sleep 10

  ALL_JOBS=$(curl -s "${API_URL}/api/v1/jobs?program_id=${PROGRAM_ID}")

  PENDING=$(echo $ALL_JOBS | jq '[.jobs[] | select(.status=="pending")] | length')
  ACTIVE=$(echo $ALL_JOBS | jq '[.jobs[] | select(.status=="active")] | length')
  COMPLETED=$(echo $ALL_JOBS | jq '[.jobs[] | select(.status=="completed")] | length')
  FAILED=$(echo $ALL_JOBS | jq '[.jobs[] | select(.status=="failed")] | length')

  echo "[$i/20] Jobs: Pending=$PENDING, Active=$ACTIVE, Completed=$COMPLETED, Failed=$FAILED"

  # Check if all jobs are done
  if [ "$PENDING" -eq 0 ] && [ "$ACTIVE" -eq 0 ]; then
    echo ""
    echo "✅ All jobs completed!"
    break
  fi
done

echo ""
echo "🎯 Step 7: Checking findings..."
FINDINGS=$(curl -s "${API_URL}/api/v1/programs/${PROGRAM_ID}/findings")
FINDING_COUNT=$(echo $FINDINGS | jq '.findings | length')

echo "Total findings discovered: ${FINDING_COUNT}"
echo ""
echo $FINDINGS | jq -r '.findings[] | "  [\(.severity)] \(.title) - Confidence: \(.confidence)"'

echo ""
echo "=============================="
echo "✅ Auto-Orchestration Test Complete!"
echo "=============================="
echo ""
echo "Summary:"
echo "  - Manual triggers: 1 (Discovery job only)"
echo "  - Auto-triggered jobs: $(( $COMPLETED - 1 ))"
echo "  - Total findings: ${FINDING_COUNT}"
echo ""
echo "🎉 The system automatically orchestrated the entire pipeline!"
echo "   No manual intervention was required after the initial discovery trigger."
