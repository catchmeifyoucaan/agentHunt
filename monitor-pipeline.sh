#!/bin/bash
# Pipeline monitoring script - tracks crawl, scanner, and three-agent jobs

echo "🔍 Pipeline Monitor - Press Ctrl+C to stop"
echo "=========================================="
echo ""

while true; do
  clear
  echo "🔍 PIPELINE STATUS - $(date)"
  echo "=========================================="
  echo ""
  
  # Get job stats
  curl -s 'http://localhost:3000/api/v1/jobs?limit=100' | jq -r '
    .jobs | group_by(.type) | 
    map({
      type: .[0].type,
      pending: ([.[] | select(.status == "pending")] | length),
      active: ([.[] | select(.status == "active")] | length),
      completed: ([.[] | select(.status == "completed")] | length),
      failed: ([.[] | select(.status == "failed")] | length),
      cancelled: ([.[] | select(.status == "cancelled")] | length)
    }) | 
    sort_by(.type) |
    .[] | 
    "\(.type | ascii_upcase):\n  Pending: \(.pending) | Active: \(.active) | Completed: \(.completed) | Failed: \(.failed) | Cancelled: \(.cancelled)"
  ' 2>/dev/null || echo "API not responding"
  
  echo ""
  echo "=========================================="
  echo "RECENT SCANNER RESULTS:"
  echo "=========================================="
  
  curl -s 'http://localhost:3000/api/v1/jobs?type=scanner&limit=5' | jq -r '
    .jobs[] | 
    select(.result != null) |
    "Job: \(.id[0:8])... | Status: \(.status) | URLs: \(.result.totalUrls // "N/A") | Findings: \(.result.findings // "N/A") | Severity: \(.result.bySeverity // {})"
  ' 2>/dev/null | head -5 || echo "No scanner results yet"
  
  echo ""
  echo "=========================================="
  echo "RECENT CRAWL RESULTS:"
  echo "=========================================="
  
  curl -s 'http://localhost:3000/api/v1/jobs?type=crawl&limit=5' | jq -r '
    .jobs[] | 
    select(.result != null) |
    "Job: \(.id[0:8])... | Status: \(.status) | URLs Found: \(.result.totalUrls // "N/A")"
  ' 2>/dev/null | head -5 || echo "No crawl results yet"
  
  echo ""
  echo "=========================================="
  echo "LATEST ERRORS (last 10 lines):"
  echo "=========================================="
  pm2 logs --nostream --lines 10 2>&1 | grep -i "error\|fail\|foreign key" | tail -5 || echo "No errors"
  
  sleep 10
done
