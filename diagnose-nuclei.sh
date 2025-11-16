#!/bin/bash
# Nuclei Scanner Diagnostic Script
# This script helps diagnose why Nuclei isn't finding vulnerabilities

echo "=== Nuclei Scanner Diagnostics ==="
echo ""

# 1. Check Nuclei version
echo "1. Nuclei Version:"
nuclei -version
echo ""

# 2. Check templates exist
echo "2. Template Paths:"
echo "  - /root/nuclei-templates/http/cves: $(find /root/nuclei-templates/http/cves -name '*.yaml' 2>/dev/null | wc -l) templates"
echo "  - /root/nuclei-templates/http/vulnerabilities: $(find /root/nuclei-templates/http/vulnerabilities -name '*.yaml' 2>/dev/null | wc -l) templates"
echo ""

# 3. Test with a known vulnerable site
echo "3. Testing Nuclei with a working URL:"
echo "http://scanme.nmap.org" > /tmp/diagnostic-urls.txt
timeout 30 nuclei \
  -l /tmp/diagnostic-urls.txt \
  -t /root/nuclei-templates/http/technologies \
  -jsonl -o /tmp/diagnostic-output.jsonl \
  -stats 2>&1 | grep -E "Templates loaded|Scan completed|Matched"

echo "  Results: $(wc -l < /tmp/diagnostic-output.jsonl) findings"
echo ""

# 4. Test with the problematic flags
echo "4. Testing with -fuzz flags (from your scanner code):"
rm -f /tmp/diagnostic-fuzz.jsonl
timeout 30 nuclei \
  -l /tmp/diagnostic-urls.txt \
  -t /root/nuclei-templates/http/technologies \
  -fuzz -fuzzing-mode single \
  -payload-concurrency 25 \
  -jsonl -o /tmp/diagnostic-fuzz.jsonl \
  2>&1 | grep -E "Templates loaded|DAST|Scan completed|Matched|Fatal|FTL"

echo "  Results: $(wc -l < /tmp/diagnostic-fuzz.jsonl 2>/dev/null || echo '0') findings"
echo ""

# 5. Check your actual URLs file
if [ -f "domainand_subs.txt" ]; then
  echo "5. Your domainand_subs.txt file:"
  echo "  - Total lines: $(wc -l < domainand_subs.txt)"
  echo "  - First 5 entries:"
  head -5 domainand_subs.txt | sed 's/^/    /'
  echo "  - URLs with http/https: $(grep -c '^https\?://' domainand_subs.txt || echo '0')"
  echo ""
fi

# 6. Recommendation
echo "6. Recommended Fixes:"
echo ""
if [ $(grep -c '^https\?://' domainand_subs.txt 2>/dev/null || echo '0') -eq 0 ]; then
  echo "  ❌ ISSUE: Your URLs don't have http:// or https:// prefixes!"
  echo "     FIX: URLs must start with http:// or https:// for Nuclei to scan them"
  echo ""
fi

echo "  💡 SUGGESTION 1: Remove the -fuzz flags from scanner.ts:204-205"
echo "     These flags require DAST templates which you may not have"
echo ""
echo "  💡 SUGGESTION 2: Ensure input URLs have proper http/https prefixes"
echo "     Nuclei needs full URLs, not just domain names"
echo ""

echo "=== Diagnostics Complete ==="
