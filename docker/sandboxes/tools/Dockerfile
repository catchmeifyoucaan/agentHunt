# AgentHunt Security Tools Sandbox
# Comprehensive security testing toolkit

FROM kalilinux/kali-rolling:latest

# Update and install common security tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core tools
    curl \
    wget \
    git \
    python3 \
    python3-pip \
    golang \
    nodejs \
    npm \
    # Network tools
    nmap \
    masscan \
    netcat-openbsd \
    dnsutils \
    whois \
    nikto \
    # Web tools
    sqlmap \
    wpscan \
    dirb \
    gobuster \
    ffuf \
    # Enumeration tools
    enum4linux \
    smbclient \
    # Exploitation tools
    metasploit-framework \
    exploitdb \
    # Other utilities
    jq \
    yq \
    xmlstarlet \
    && rm -rf /var/lib/apt/lists/*

# Install ProjectDiscovery tools
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && \
    go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest && \
    go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest && \
    go install -v github.com/projectdiscovery/katana/cmd/katana@latest && \
    go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest && \
    go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest

# Install additional Go tools
RUN go install -v github.com/tomnomnom/httprobe@latest && \
    go install -v github.com/tomnomnom/waybackurls@latest && \
    go install -v github.com/tomnomnom/assetfinder@latest && \
    go install -v github.com/tomnomnom/gf@latest && \
    go install -v github.com/jaeles-project/gospider@latest

# Create non-root user for code execution
RUN useradd -m -u 1000 -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown -R sandbox:sandbox /workspace

# Copy Go binaries to user path
RUN cp /root/go/bin/* /usr/local/bin/ || true

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
