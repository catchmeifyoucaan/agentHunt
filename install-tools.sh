#!/bin/bash
set -e

echo "============================================"
echo "AgentHunt Security Tools Installation"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo -e "${YELLOW}Go is not installed. Installing Go...${NC}"
    wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz
    rm go1.21.5.linux-amd64.tar.gz
    export PATH=$PATH:/usr/local/go/bin
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /root/.bashrc
    echo -e "${GREEN}Go installed successfully${NC}"
fi

# Ensure Go is in PATH
export PATH=$PATH:/usr/local/go/bin
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin

echo -e "${YELLOW}Installing ProjectDiscovery tools...${NC}"
echo ""

# Install chaos-client
echo -e "${YELLOW}[1/11] Installing chaos-client...${NC}"
go install -v github.com/projectdiscovery/chaos-client/cmd/chaos@latest
cp $GOPATH/bin/chaos /usr/local/bin/chaos-client 2>/dev/null || cp $HOME/go/bin/chaos /usr/local/bin/chaos-client
echo -e "${GREEN}✓ chaos-client installed${NC}"

# Install subfinder
echo -e "${YELLOW}[2/11] Installing subfinder...${NC}"
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
cp $GOPATH/bin/subfinder /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/subfinder /usr/local/bin/
echo -e "${GREEN}✓ subfinder installed${NC}"

# Install nuclei
echo -e "${YELLOW}[3/11] Installing nuclei...${NC}"
go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
cp $GOPATH/bin/nuclei /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/nuclei /usr/local/bin/
echo -e "${GREEN}✓ nuclei installed${NC}"

# Install httpx
echo -e "${YELLOW}[4/11] Installing httpx...${NC}"
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
cp $GOPATH/bin/httpx /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/httpx /usr/local/bin/
echo -e "${GREEN}✓ httpx installed${NC}"

# Install katana
echo -e "${YELLOW}[5/11] Installing katana...${NC}"
go install github.com/projectdiscovery/katana/cmd/katana@latest
cp $GOPATH/bin/katana /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/katana /usr/local/bin/
echo -e "${GREEN}✓ katana installed${NC}"

# Install naabu
echo -e "${YELLOW}[6/11] Installing naabu...${NC}"
apt-get update -qq && apt-get install -y -qq libpcap-dev > /dev/null 2>&1
go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest
cp $GOPATH/bin/naabu /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/naabu /usr/local/bin/
echo -e "${GREEN}✓ naabu installed${NC}"

# Install dnsx
echo -e "${YELLOW}[7/11] Installing dnsx...${NC}"
go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest
cp $GOPATH/bin/dnsx /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/dnsx /usr/local/bin/
echo -e "${GREEN}✓ dnsx installed${NC}"

# Install tlsx
echo -e "${YELLOW}[8/11] Installing tlsx...${NC}"
go install github.com/projectdiscovery/tlsx/cmd/tlsx@latest
cp $GOPATH/bin/tlsx /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/tlsx /usr/local/bin/
echo -e "${GREEN}✓ tlsx installed${NC}"

# Install shuffledns
echo -e "${YELLOW}[9/11] Installing shuffledns...${NC}"
go install -v github.com/projectdiscovery/shuffledns/cmd/shuffledns@latest
cp $GOPATH/bin/shuffledns /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/shuffledns /usr/local/bin/
echo -e "${GREEN}✓ shuffledns installed${NC}"

# Install amass
echo -e "${YELLOW}[10/11] Installing amass...${NC}"
go install -v github.com/owasp-amass/amass/v4/...@master
cp $GOPATH/bin/amass /usr/local/bin/ 2>/dev/null || cp $HOME/go/bin/amass /usr/local/bin/
echo -e "${GREEN}✓ amass installed${NC}"

# Install massdns
echo -e "${YELLOW}[11/11] Installing massdns...${NC}"
apt-get install -y -qq git make gcc > /dev/null 2>&1
cd /tmp
rm -rf massdns
git clone --quiet https://github.com/blechschmidt/massdns.git
cd massdns
make > /dev/null 2>&1
cp bin/massdns /usr/local/bin/
cd /tmp
rm -rf massdns
echo -e "${GREEN}✓ massdns installed${NC}"

echo ""
echo -e "${YELLOW}Installing nuclei templates...${NC}"
mkdir -p /app/tools/templates
nuclei -update-templates -templates-directory /app/tools/templates/nuclei > /dev/null 2>&1
echo -e "${GREEN}✓ Nuclei templates installed${NC}"

echo ""
echo -e "${YELLOW}Setting up wordlists directory...${NC}"
mkdir -p /app/tools/wordlists
echo -e "${GREEN}✓ Wordlists directory created${NC}"

echo ""
echo "============================================"
echo -e "${GREEN}Installation Summary${NC}"
echo "============================================"
echo ""

# Verify all tools
TOOLS=(
    "/usr/local/bin/chaos-client:Chaos Client"
    "/usr/local/bin/subfinder:Subfinder"
    "/usr/local/bin/amass:Amass"
    "/usr/local/bin/nuclei:Nuclei"
    "/usr/local/bin/httpx:HTTPX"
    "/usr/local/bin/katana:Katana"
    "/usr/local/bin/naabu:Naabu"
    "/usr/local/bin/dnsx:DNSX"
    "/usr/local/bin/tlsx:TLSX"
    "/usr/local/bin/shuffledns:ShuffleDNS"
    "/usr/local/bin/massdns:MassDNS"
)

FAILED=0

for tool_info in "${TOOLS[@]}"; do
    IFS=':' read -r path name <<< "$tool_info"
    if [ -f "$path" ]; then
        version=$($path -version 2>&1 | head -1 || $path --version 2>&1 | head -1 || echo "installed")
        echo -e "${GREEN}✓${NC} $name: $version"
    else
        echo -e "${RED}✗${NC} $name: NOT FOUND"
        FAILED=1
    fi
done

echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tools installed successfully!${NC}"
    exit 0
else
    echo -e "${RED}Some tools failed to install. Please check the errors above.${NC}"
    exit 1
fi
