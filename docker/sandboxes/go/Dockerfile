# AgentHunt Go Sandbox
# Secure, isolated environment for executing Go code

FROM golang:1.21-alpine

# Install common dependencies
RUN apk add --no-cache \
    curl \
    wget \
    git \
    gcc \
    musl-dev \
    bash

# Install common Go packages for security testing
RUN go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && \
    go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest && \
    go install github.com/projectdiscovery/httpx/cmd/httpx@latest && \
    go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest && \
    go install github.com/tomnomnom/httprobe@latest && \
    go install github.com/tomnomnom/waybackurls@latest

# Create non-root user for code execution
RUN adduser -D -u 1000 sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown -R sandbox:sandbox /workspace

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

# Add Go binaries to PATH
ENV PATH="/home/sandbox/go/bin:${PATH}"

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
