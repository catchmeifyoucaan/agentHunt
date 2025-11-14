# AgentHunt Node.js Sandbox
# Secure, isolated environment for executing JavaScript/TypeScript code

FROM node:20-slim

# Install common dependencies and security tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install common npm packages for security testing
RUN npm install -g \
    axios \
    cheerio \
    puppeteer \
    playwright \
    node-fetch \
    ws \
    socket.io-client \
    jsonwebtoken \
    bcrypt \
    crypto-js \
    dns-lookup \
    whois \
    ssh2 \
    node-nmap

# Install TypeScript and ts-node for TypeScript support
RUN npm install -g typescript ts-node

# Create non-root user for code execution
RUN useradd -m -u 1000 -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown -R sandbox:sandbox /workspace

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

# Set Node to production mode
ENV NODE_ENV=production

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
