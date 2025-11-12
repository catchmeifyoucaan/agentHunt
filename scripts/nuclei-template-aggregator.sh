#!/bin/bash

#########################################
# Nuclei Template Aggregator
# Downloads 150k+ templates from multiple sources
# Handles duplicates, cleaning, and organization
#########################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORK_DIR="/tmp/nuclei-aggregator-$(date +%s)"
FINAL_DIR="/home/user/agentHunt/nuclei-templates"
CLONE_DIR="$WORK_DIR/clones"
EXTRACTED_DIR="$WORK_DIR/extracted"
LOG_FILE="$WORK_DIR/aggregator.log"

# Statistics
TOTAL_REPOS=0
SUCCESSFUL_CLONES=0
FAILED_CLONES=0
TOTAL_TEMPLATES=0
DUPLICATE_TEMPLATES=0

# Create directories
mkdir -p "$WORK_DIR" "$CLONE_DIR" "$EXTRACTED_DIR" "$FINAL_DIR"

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

# Clean URL function - removes trailing spaces, dashes, .git
clean_url() {
    local url="$1"
    # Remove leading/trailing whitespace
    url=$(echo "$url" | xargs)
    # Remove trailing .git if present
    url="${url%.git}"
    # Remove trailing slashes
    url="${url%/}"
    echo "$url"
}

# Extract repo name from URL
get_repo_name() {
    local url="$1"
    # Extract owner/repo from URL
    echo "$url" | sed -E 's|.*github\.com/([^/]+/[^/]+).*|\1|' | tr '/' '_'
}

# Clone repository with retry
clone_repo() {
    local url="$1"
    local dest="$2"
    local retries=3
    local count=0

    while [ $count -lt $retries ]; do
        if git clone --depth 1 "$url" "$dest" 2>/dev/null; then
            return 0
        fi
        count=$((count + 1))
        sleep 2
    done
    return 1
}

# Download gist
download_gist() {
    local gist_url="$1"
    local dest="$2"

    # Extract gist ID
    local gist_id=$(echo "$gist_url" | grep -oP 'gist\.github\.com/[^/]+/?\K[a-f0-9]+' || echo "$gist_url" | grep -oP 'gist\.github\.com/\K[a-f0-9]+')

    if [ -n "$gist_id" ]; then
        git clone "https://gist.github.com/$gist_id.git" "$dest" 2>/dev/null
        return $?
    fi
    return 1
}

# Find and extract all nuclei templates
extract_templates() {
    local source_dir="$1"
    local repo_name="$2"

    log_info "Extracting templates from $repo_name..."

    # Find all YAML files that look like nuclei templates
    find "$source_dir" -type f \( -name "*.yaml" -o -name "*.yml" \) | while read -r template; do
        # Skip if file is empty or too small (< 50 bytes)
        if [ ! -s "$template" ] || [ $(stat -f%z "$template" 2>/dev/null || stat -c%s "$template" 2>/dev/null) -lt 50 ]; then
            continue
        fi

        # Check if it's a nuclei template (contains 'id:' field)
        if grep -q "^id:" "$template" 2>/dev/null; then
            # Extract template ID for uniqueness
            local template_id=$(grep "^id:" "$template" | head -1 | sed 's/id: *//' | tr -d '[:space:]')

            if [ -n "$template_id" ]; then
                # Create destination path based on template structure
                local rel_path=$(realpath --relative-to="$source_dir" "$template")
                local dest_file="$EXTRACTED_DIR/${repo_name}__${rel_path}"

                # Create directory structure
                mkdir -p "$(dirname "$dest_file")"

                # Copy template
                cp "$template" "$dest_file"
                TOTAL_TEMPLATES=$((TOTAL_TEMPLATES + 1))
            fi
        fi
    done
}

# Execute scripts that download templates
execute_download_scripts() {
    local source_dir="$1"
    local repo_name="$2"

    log_info "Looking for download scripts in $repo_name..."

    # Find shell scripts
    find "$source_dir" -type f \( -name "*.sh" -o -name "download*" -o -name "fetch*" \) | while read -r script; do
        if [ -x "$script" ] || head -1 "$script" | grep -q "^#!/"; then
            log_info "Found script: $(basename "$script")"

            # Create temporary execution directory
            local exec_dir="$WORK_DIR/exec_$repo_name"
            mkdir -p "$exec_dir"
            cd "$exec_dir"

            # Try to execute (with timeout to prevent hanging)
            timeout 60 bash "$script" 2>/dev/null || true

            # Extract any templates created
            extract_templates "$exec_dir" "${repo_name}_script"

            cd - > /dev/null
        fi
    done
}

# Deduplicate templates based on content hash
deduplicate_templates() {
    log "Deduplicating templates..."

    declare -A seen_hashes
    local dedupe_dir="$WORK_DIR/deduplicated"
    mkdir -p "$dedupe_dir"

    find "$EXTRACTED_DIR" -type f \( -name "*.yaml" -o -name "*.yml" \) | while read -r template; do
        # Calculate hash of template content
        local hash=$(md5sum "$template" | cut -d' ' -f1)

        if [ -z "${seen_hashes[$hash]}" ]; then
            # First time seeing this template
            seen_hashes[$hash]="$template"

            # Copy to deduplicated directory
            local rel_path=$(realpath --relative-to="$EXTRACTED_DIR" "$template")
            local dest="$dedupe_dir/$rel_path"
            mkdir -p "$(dirname "$dest")"
            cp "$template" "$dest"
        else
            DUPLICATE_TEMPLATES=$((DUPLICATE_TEMPLATES + 1))
        fi
    done

    # Replace extracted dir with deduplicated
    rm -rf "$EXTRACTED_DIR"
    mv "$dedupe_dir" "$EXTRACTED_DIR"
}

# Organize templates by category
organize_templates() {
    log "Organizing templates by category..."

    find "$EXTRACTED_DIR" -type f \( -name "*.yaml" -o -name "*.yml" \) | while read -r template; do
        # Try to determine category from path or content
        local category="miscellaneous"

        if echo "$template" | grep -qi "cve"; then
            category="cves"
        elif echo "$template" | grep -qi "panel"; then
            category="panels"
        elif echo "$template" | grep -qi "exposed"; then
            category="exposures"
        elif echo "$template" | grep -qi "misconfiguration"; then
            category="misconfigurations"
        elif echo "$template" | grep -qi "takeover"; then
            category="takeovers"
        elif echo "$template" | grep -qi "fuzzing"; then
            category="fuzzing"
        elif echo "$template" | grep -qi "workflow"; then
            category="workflows"
        elif grep -q "severity: critical" "$template" 2>/dev/null; then
            category="vulnerabilities/critical"
        elif grep -q "severity: high" "$template" 2>/dev/null; then
            category="vulnerabilities/high"
        fi

        # Copy to final directory with category
        local filename=$(basename "$template")
        local dest="$FINAL_DIR/$category/$filename"
        mkdir -p "$(dirname "$dest")"

        # Handle filename conflicts
        local counter=1
        while [ -f "$dest" ]; then
            local base="${filename%.*}"
            local ext="${filename##*.}"
            dest="$FINAL_DIR/$category/${base}_${counter}.${ext}"
            counter=$((counter + 1))
        done

        cp "$template" "$dest"
    done
}

# Process URL list
process_urls() {
    local url_list="$1"

    while IFS= read -r url; do
        # Skip empty lines and comments
        [[ -z "$url" || "$url" =~ ^[[:space:]]*# ]] && continue

        # Clean URL
        url=$(clean_url "$url")
        [[ -z "$url" ]] && continue

        TOTAL_REPOS=$((TOTAL_REPOS + 1))

        # Get repository name
        local repo_name=$(get_repo_name "$url")
        local clone_path="$CLONE_DIR/$repo_name"

        log_info "Processing ($TOTAL_REPOS): $url"

        # Check if it's a gist
        if echo "$url" | grep -q "gist.github.com"; then
            if download_gist "$url" "$clone_path"; then
                SUCCESSFUL_CLONES=$((SUCCESSFUL_CLONES + 1))
                extract_templates "$clone_path" "$repo_name"
            else
                log_error "Failed to download gist: $url"
                FAILED_CLONES=$((FAILED_CLONES + 1))
            fi
        else
            # Regular repository
            if clone_repo "$url" "$clone_path"; then
                SUCCESSFUL_CLONES=$((SUCCESSFUL_CLONES + 1))
                extract_templates "$clone_path" "$repo_name"
                execute_download_scripts "$clone_path" "$repo_name"
            else
                log_error "Failed to clone: $url"
                FAILED_CLONES=$((FAILED_CLONES + 1))
            fi
        fi

        # Periodic cleanup to save disk space
        if [ $((TOTAL_REPOS % 20)) -eq 0 ]; then
            log "Cleaning up clones to save space..."
            rm -rf "$CLONE_DIR"/*
        fi

    done < "$url_list"
}

# Generate statistics report
generate_report() {
    log ""
    log "========================================="
    log "  Nuclei Template Aggregation Complete  "
    log "========================================="
    log ""
    log "Statistics:"
    log "  Total Repositories Processed: $TOTAL_REPOS"
    log "  Successful Clones: $SUCCESSFUL_CLONES"
    log "  Failed Clones: $FAILED_CLONES"
    log "  Total Templates Collected: $TOTAL_TEMPLATES"
    log "  Duplicate Templates Removed: $DUPLICATE_TEMPLATES"
    log "  Unique Templates: $((TOTAL_TEMPLATES - DUPLICATE_TEMPLATES))"
    log ""
    log "Templates saved to: $FINAL_DIR"
    log "Log file: $LOG_FILE"
    log ""

    # Count templates by category
    log "Templates by category:"
    find "$FINAL_DIR" -mindepth 1 -maxdepth 1 -type d | while read -r category; do
        local count=$(find "$category" -type f | wc -l)
        log "  $(basename "$category"): $count templates"
    done
}

# Main execution
main() {
    log "Starting Nuclei Template Aggregator..."
    log "Work directory: $WORK_DIR"
    log "Final directory: $FINAL_DIR"
    log ""

    # Create URL list file
    local url_file="$WORK_DIR/urls.txt"
    cat > "$url_file" << 'URLS'
https://github.com/adampielak/nuclei-templates
https://gist.github.com/0x240x23elu
https://github.com/0x727/ObserverWard_0x727
https://github.com/0xAwali/Blind-SSRF
https://github.com/0xAwali/Virtual-Host
https://github.com/1in9e/my-nuclei-templates
https://github.com/5cr1pt/templates
https://github.com/arielril/nuclei-templates
https://github.com/ARPSyndicate/kenzer-templates
https://github.com/AshiqurEmon/nuclei_templates
https://github.com/BeRserKerSec/CVE-2021-26084-Nuclei-template
https://github.com/bjhulst/nuclei-custom-templates
https://github.com/bufferbandit/gitScanNucleiTemplate
https://github.com/c0rv4x/scanfactory-nuclei-templates
https://github.com/c3l3si4n/malicious_nuclei_templates
https://github.com/CharanRayudu/Custom-Nuclei-Templates
https://github.com/ChiaraNRTT96/BountySkill
https://github.com/clarkvoss/Nuclei-Templates
https://github.com/compr00t/nuclei-templates
https://github.com/d3sca/Nuclei_Templates
https://github.com/daffainfo/my-nuclei-templates
https://github.com/danielmofer/nuclei_templates
https://github.com/ekinsb/Nuclei-Templates
https://github.com/emadshanab/nuclei-templates
https://github.com/emadshanab/Nuclei-Templates-Collection
https://github.com/esetal/nuclei-bb-templates
https://github.com/ethicalhackingplayground/erebus
https://github.com/ethicalhackingplayground/erebus-templates
https://github.com/foulenzer/foulenzer-templates
https://github.com/geeknik/nuclei-templates-1
https://github.com/geeknik/the-nuclei-templates
https://github.com/Harish4948/Nuclei-Templates
https://github.com/im403/nuclei-temp
https://github.com/javaongsan/nuclei-templates
https://github.com/joanbono/nuclei-templates
https://github.com/kabilan1290/templates
https://github.com/lliwi/nuclei-repo-hunter
https://github.com/manasmbellani/nuclei-templates
https://github.com/marcositu/nuclei-custom-templates
https://github.com/medbsq/ncl
https://github.com/meme-lord/Custom-Nuclei-Templates
https://github.com/michaelklaan/my-nuclei-templates
https://github.com/michaelklaan/nuclei-templates
https://github.com/Mr219/nuclei_templates
https://github.com/MR-pentestGuy/nuclei-templates
https://github.com/n1f2c3/mytemplates
https://github.com/Nithissh0708/Custom-Nuclei-Templates
https://github.com/NitinYadav00/My-Nuclei-Templates
https://github.com/notnotnotveg/nuclei-custom-templates
https://github.com/obreinx/nuceli-templates
https://github.com/optiv/mobile-nuclei-templates
https://github.com/p3n73st3r/Nuclei-Templates
https://github.com/panch0r3d/nuclei-templates
https://github.com/peanuth8r/Nuclei_Templates
https://github.com/pikpikcu/my-nuclei-templates
https://github.com/pikpikcu/nuclei-templates
https://github.com/projectdiscovery/nuclei-templates
https://github.com/rafaelcaria/Nuclei-Templates
https://github.com/rahulkadavil/nuclei-templates
https://github.com/randomstr1ng/nuclei-sap-templates
https://github.com/redteambrasil/nuclei-templates
https://github.com/ree4pwn/my-nuclei-templates
https://github.com/R-s0n/Custom_Vuln_Scan_Templates
https://github.com/sadnansakin/my-nuclei-templates
https://github.com/Saimonkabir/Nuclei-Templates
https://github.com/Saptak9983/Nuclei-Template
https://github.com/securitytest3r/nuclei_templates_work
https://github.com/sharathkramadas/k8s-nuclei-templates
https://github.com/shifa123/detections
https://github.com/shifa123/nuclei-templates-all
https://github.com/sickwell/nuclei-templates
https://github.com/smaranchand/nuclei-templates
https://github.com/sobinge/nuclei-templates
https://github.com/souzomain/mytemplates
https://github.com/Str1am/my-nuclei-templates
https://github.com/sudo-jtcsec/public-nuclei-templates
https://github.com/sushant-kamble/mynuclei-template
https://github.com/System00-Security/backflow
https://github.com/tedmdelacruz/custom-nuclei-templates
https://github.com/test502git/log4j-fuzz-head-poc
https://github.com/thebrnwal/Content-Injection-Nuclei-Script
https://github.com/thelabda/nuclei-templates
https://github.com/toramanemre/apache-solr-log4j-CVE-2021-44228
https://github.com/toramanemre/log4j-rce-detect-waf-bypass
https://github.com/trickest/log4j
https://github.com/vysecurity/nuclei-templates-notags
https://github.com/wr00t/templates
https://github.com/yavolo/nuclei-templates
https://github.com/z3bd/nuclei-templates
https://github.com/zinminphyo0/KozinTemplates
https://github.com/c-sh0/nuclei_templates
https://github.com/MikeeI/nuclei-templates
https://github.com/alexrydzak/rydzak-nuclei-templates
https://github.com/brinhosa/brinhosa-nuclei-templates
https://github.com/Akokonunes/Private-Nuclei-Templates
https://github.com/rafaelwdornelas/my-nuclei-templates
https://github.com/glyptho/templatesallnuclei
https://github.com/kh4sh3i/CVE-2022-23131
https://github.com/ShangRui-hash/my-nuclei-templates
https://github.com/dk4trin/templates-nuclei
https://github.com/Elsfa7-110/mynuclei-templates
https://github.com/ping-0day/templates
https://github.com/wasp76b/nuclei-templates
https://github.com/th3r4id/nuclei-templates
https://github.com/themastersunil/Nuclei-TamplatesBackup
https://github.com/justmumu/SpringShell
https://github.com/blazeinfosec/nuclei-templates
https://github.com/KeepHowling/all_freaking_nuclei_templates
https://github.com/Odayex/Random-Nuclei-Templates
https://github.com/themastersunil/nucleiDB
https://github.com/Linuxinet/nuclei-templates
https://github.com/aels/CVE-2022-37042
https://github.com/pentest-dev/Profesional-Nuclei-Templates
https://github.com/Aituglo/nuclei-templates
https://github.com/NightRang3r/misc_nuclei_templates
https://github.com/0XParthJ/Nuclei-Templates
https://github.com/trungkay2/Nuclei-template
https://github.com/ExpLangcn/NucleiTP
https://github.com/0xmaximus/final_freaking_nuclei_templates
https://github.com/Jagomeiister/nuclei-templates
https://github.com/Lopseg/nuclei-c-templates
https://github.com/p0ch4t/nuclei-special-templates
https://github.com/sl4x0/NC-Templates
https://github.com/thecyberneh/nuclei-templatess
https://github.com/yarovit-developer/nuclei-templates
https://github.com/cipher387/juicyinfo-nuclei-templates
https://github.com/Kaue-Navarro/Templates-kaue-nuclei
https://github.com/JoshMorrison99/url-based-nuclei-templates
https://github.com/abbycantcode/Nuclei-Template
https://github.com/ayadim/Nuclei-bug-hunter
https://github.com/pacho15/mynuclei_templates
https://github.com/soumya123raj/Nuclei
https://github.com/soapffz/myown-nuclei-poc
https://github.com/zer0yu/Open-PoC
https://github.com/SumedhDawadi/Custom-Nuclei-Template
https://github.com/coldrainh/nuclei-ByMyself
https://github.com/binod235/nuclei-templates-and-reports
https://github.com/mbskter/Masscan2Httpx2Nuclei-Xray
https://github.com/luck-ying/Library-YAML-POC
https://github.com/PedroFerreira97/nuclei_templates
https://github.com/Hunt2behunter/nuclei-templates
https://github.com/mastersir-lab/nuclei-yaml-poc
https://github.com/SirAppSec/nuclei-template-generator-log4j
https://github.com/0xPugazh/my-nuclei-templates
https://github.com/1dayluo/My-Nuclei-Templates
https://github.com/topscoder/nuclei-wordfence-cve
https://github.com/drfabiocastro/certwatcher-templates
https://github.com/erickfernandox/nuclei-templates
https://github.com/damon-sec/Nuclei-templates-Collection
https://github.com/DoubleTakes/nuclei-templates
https://github.com/ptyspawnbinbash/template-enhancer
https://github.com/Arvinthksrct/alltemplate
https://github.com/srkgupta/cent-nuclei-templates
https://github.com/UltimateSec/ultimaste-nuclei-templates
https://github.com/xinZa1/template
https://github.com/SirBugs/Priv8-Nuclei-Templates
https://github.com/davidfortytwo/GetNucleiTemplates
https://github.com/v3l4r10/Nuclei-Templates
https://github.com/lkuik/nuclei-templates
https://github.com/wearetyomsmnv/llm_integrated_nuclei_templates
https://github.com/U53RW4R3/nuclei-fuzzer-templates
https://github.com/edoardottt/missing-cve-nuclei-templates
https://github.com/szybnev/nuclei-custom
https://github.com/r3dcl1ff/Symfony-Fuck
https://github.com/RandomRobbieBF/nuclei-drupal-sa
https://github.com/ed-red/redmc_custom_templates_nuclei
https://github.com/imhunterand/nuclei-custom-templates
https://github.com/vulnspace/nuclei-templates
https://github.com/valaDevs/nuclei-backupfile-finder
https://github.com/h0tak88r/nuclei_templates
https://github.com/solo10010/solo-nuclei-templates
https://github.com/Excis3/bans4-nuclei
https://github.com/Dalaho-bangin/my_nuclei_templates
https://github.com/pikpikcu/nuclei-fuzz
https://github.com/jhonnybonny/nuclei-templates-bitrix
https://github.com/nikhilhvr/nuclei-templates
https://github.com/boobooHQ/private_templates
https://github.com/ShadowHackrs/Nuclei-templates
https://github.com/schooldropout1337/nuclei-templates
https://github.com/AggressiveUser/AllForOne
https://github.com/0xKayala/Custom-Nuclei-Templates
https://github.com/geeknik/the-nuclei-templates
https://github.com/zerbaliy3v/custom-nuclei-templates
https://gist.github.com/ResistanceIsUseless/e46848f67706a8aa1205c9d2866bff31
https://github.com/0x727/ObserverWard
https://github.com/0xSojalSec/kenzer-templates
https://github.com/0xSojalSec/my-nuclei-templates-1
https://github.com/0xSojalSec/nuclei-templates-4
https://github.com/0xSojalSec/nuclei-templates-5
https://github.com/0xSojalSec/Nuclei-Templates-API-Linkfinder
https://github.com/0xSojalSec/Nuclei-Templates-Collection
https://github.com/0xSojalSec/templatesallnuclei
https://github.com/b4dboy17/badboy_17-Nuclei-Templates-Collection
https://github.com/badboy-sft/badboy_17-Nuclei-Templates-Collection
https://github.com/bhataasim1/PersonalTemplates
https://github.com/bug-vs-me/nuclei
https://github.com/davidfortytwo/GetNucleiTemplates
https://github.com/edoardottt/missing-cve-nuclei-templates
https://github.com/freakyclown/Nuclei_templates
https://github.com/h4ndsh/nuclei-templates
https://github.com/kh4sh3i/nuclei-templates
https://github.com/Linuxinet/mobile-nuclei-templates
https://github.com/Lu3ky13/Authorization-Nuclei-Templates
https://github.com/microphone-mathematics/custom-nuclei-templates
https://github.com/mosesrenegade/nuclei-templates
https://github.com/nvsecurity/nightvision-nuclei-templates
https://github.com/pdelteil/BugBountyReportTemplates
https://github.com/PedroF-369/nuclei_templates
https://github.com/praetorian-inc/chariot-launch-nuclei-templates
https://github.com/projectdiscovery/fuzzing-templates
https://github.com/Red-Darkin/Custom-Nuclei-Templates
https://github.com/reewardius/log4shell-templates
https://github.com/ricardomaia/nuclei-template-generator-for-wordpress-plugins
https://github.com/rix4uni/BugBountyTips
https://github.com/tamimhasan404/Open-Source-Nuclei-Templates-Downloader
https://github.com/thanhnx9/nuclei-templates-cutomer
https://github.com/thelabda/labdanuclei
https://github.com/themoonbaba/private_templates
https://github.com/VulnExpo/nuclei-templates
https://github.com/projectdiscovery/nuclei-templates-ai
URLS

    # Process all URLs
    process_urls "$url_file"

    # Deduplicate templates
    deduplicate_templates

    # Organize into categories
    organize_templates

    # Generate final report
    generate_report

    # Cleanup
    log "Cleaning up temporary files..."
    rm -rf "$CLONE_DIR"

    log "Done! Check $FINAL_DIR for your templates."
}

# Run main function
main "$@"
