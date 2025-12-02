#!/bin/bash
###############################################################################
# 🚀 QUICK RICH HANDOFF TEST SCRIPT
#
# Fast validation script that tests key rich handoff workflows
# Uses example.com and bugcrowd.com as test domains
#
# Usage: ./test-rich-handoffs-quick.sh
###############################################################################

set -e

API_BASE="${API_BASE:-http://localhost:3000/api/v1}"
TEST_DOMAINS=("example.com" "bugcrowd.com")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
log_section() {
  echo -e "\n${CYAN}========================================${NC}"
  echo -e "${CYAN}$1${NC}"
  echo -e "${CYAN}========================================${NC}\n"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check server health
check_health() {
  log_section "Server Health Check"

  if curl -s -f http://localhost:3000/health > /dev/null 2>&1; then
    log_success "Server is running"
    return 0
  else
    log_error "Server is not running!"
    log_info "Start the backend with: npm run dev"
    exit 1
  fi
}

# Create test program
create_program() {
  log_section "Creating Test Program"

  PROGRAM_SLUG="handoff-quick-test-$(date +%s)"

  RESPONSE=$(curl -s -X POST "${API_BASE}/programs" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"Rich Handoff Quick Test\",
      \"slug\": \"${PROGRAM_SLUG}\",
      \"platform\": \"bugcrowd\",
      \"scope\": {
        \"domains\": [\"example.com\", \"bugcrowd.com\"],
        \"wildcardDomains\": [\"*.example.com\", \"*.bugcrowd.com\"]
      }
    }")

  PROGRAM_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$PROGRAM_ID" ]; then
    log_error "Failed to create program"
    echo "$RESPONSE"
    exit 1
  fi

  log_success "Program created: $PROGRAM_ID"
  echo "$PROGRAM_ID"
}

# Test handoff workflow
test_handoff() {
  local SOURCE_AGENT=$1
  local TARGET_AGENT=$2
  local JOB_OPTIONS=$3
  local DESCRIPTION=$4

  echo ""
  log_info "Testing: ${SOURCE_AGENT} → ${TARGET_AGENT}"
  log_info "Description: $DESCRIPTION"

  # Create job
  JOB_RESPONSE=$(curl -s -X POST "${API_BASE}/jobs" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"${SOURCE_AGENT}\",
      \"programId\": \"${PROGRAM_ID}\",
      \"options\": ${JOB_OPTIONS}
    }")

  JOB_ID=$(echo "$JOB_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$JOB_ID" ]; then
    log_warning "Failed to create ${SOURCE_AGENT} job"
    return 1
  fi

  log_info "Job created: $JOB_ID"

  # Wait for job completion (max 2 minutes)
  MAX_WAIT=120
  ELAPSED=0

  while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep 3
    ELAPSED=$((ELAPSED + 3))

    STATUS_RESPONSE=$(curl -s "${API_BASE}/jobs/${JOB_ID}")
    STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ "$STATUS" = "completed" ]; then
      log_success "Job completed"
      break
    elif [ "$STATUS" = "failed" ]; then
      log_error "Job failed"
      return 1
    fi
  done

  if [ $ELAPSED -ge $MAX_WAIT ]; then
    log_warning "Job timeout"
    return 1
  fi

  # Check for handoff
  sleep 2
  HANDOFF_RESPONSE=$(curl -s "${API_BASE}/jobs?parentJobId=${JOB_ID}&type=${TARGET_AGENT}")
  HANDOFF_COUNT=$(echo "$HANDOFF_RESPONSE" | grep -c "\"id\":" || true)

  if [ "$HANDOFF_COUNT" -gt 0 ]; then
    log_success "Handoff to ${TARGET_AGENT} created! ✨"
    return 0
  else
    log_warning "No handoff to ${TARGET_AGENT} detected (may be 0 results)"
    return 1
  fi
}

# Main test suite
main() {
  log_section "🎯 QUICK RICH HANDOFF TEST SUITE"
  log_info "Test domains: ${TEST_DOMAINS[*]}"

  # Health check
  check_health

  # Create program
  PROGRAM_ID=$(create_program)

  # Track results
  TOTAL_TESTS=0
  PASSED_TESTS=0

  # Test 1: Subdomain → Discovery
  log_section "Test 1: Subdomain → Discovery"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "subdomain" "discovery" \
    '{"domains":["example.com","bugcrowd.com"],"sources":["subfinder"]}' \
    "Passive subdomain enumeration → HTTP/HTTPS probing"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 2: Bruteforce → Discovery
  log_section "Test 2: Bruteforce → Discovery"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "bruteforce" "discovery" \
    '{"domains":["example.com"],"tools":["puredns"],"wordlist":"small"}' \
    "Active DNS bruteforce → HTTP probing"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 3: Discovery → Fingerprint
  log_section "Test 3: Discovery → Fingerprint"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "discovery" "fingerprint" \
    '{"domains":["example.com","bugcrowd.com"],"probeHttp":true,"probeHttps":true}' \
    "Alive asset discovery → Technology fingerprinting"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 4: Discovery → Crawl
  log_section "Test 4: Discovery → Crawl"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "discovery" "crawl" \
    '{"domains":["example.com"],"screenshot":false}' \
    "Alive web services → URL crawling"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 5: Crawl → XSS
  log_section "Test 5: Crawl → XSS"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "crawl" "xss" \
    '{"targetUrls":["https://example.com"],"depth":2,"maxUrls":50}' \
    "URL crawling → XSS scanning"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 6: Portscan → Scanner
  log_section "Test 6: Portscan → Scanner"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "portscan" "scanner" \
    '{"targets":["example.com","bugcrowd.com"],"ports":"80,443,8080,8443","fast":true}' \
    "Port scanning → Infrastructure vulnerability scanning"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 7: OSINT → Triage
  log_section "Test 7: OSINT → Triage"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "osint" "triage" \
    '{"domains":["example.com"],"searchCredentials":true,"searchGithub":true}' \
    "Leaked credentials/secrets → AI triage"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Test 8: Cloudmisconfig → Triage
  log_section "Test 8: Cloudmisconfig → Triage"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if test_handoff "cloudmisconfig" "triage" \
    '{"domains":["example.com"],"keywords":["backup","test"],"checkS3":true}' \
    "Exposed cloud storage → Risk assessment"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
  fi

  # Summary
  log_section "📊 TEST SUMMARY"

  PASS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_TESTS / $TOTAL_TESTS) * 100}")

  log_info "Total tests: $TOTAL_TESTS"
  log_success "Passed: $PASSED_TESTS ($PASS_RATE%)"

  if [ $PASSED_TESTS -lt $TOTAL_TESTS ]; then
    FAILED=$((TOTAL_TESTS - PASSED_TESTS))
    log_warning "Failed/Skipped: $FAILED ($(awk "BEGIN {printf \"%.1f\", (100 - $PASS_RATE)}")%)"
  fi

  log_section "🎉 QUICK TEST COMPLETE"

  log_info "\nRun the comprehensive test for full coverage:"
  log_info "  npx ts-node test-rich-handoffs-comprehensive.ts"

  # Exit code based on results
  if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
    exit 0
  else
    exit 1
  fi
}

# Run main
main "$@"
