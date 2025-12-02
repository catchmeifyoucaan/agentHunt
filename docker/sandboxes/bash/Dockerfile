# AgentHunt Bash Sandbox
# Secure, isolated environment for executing bash scripts

FROM ubuntu:22.04

# Install common CLI tools and utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    jq \
    yq \
    xmlstarlet \
    gawk \
    sed \
    grep \
    netcat-openbsd \
    dnsutils \
    iproute2 \
    iputils-ping \
    nmap \
    whois \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for code execution
RUN useradd -m -u 1000 -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown -R sandbox:sandbox /workspace

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
