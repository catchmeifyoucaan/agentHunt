# AgentHunt Python Sandbox
# Secure, isolated environment for executing Python code

FROM python:3.11-slim

# Install common security tools and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install common Python packages for security testing
RUN pip install --no-cache-dir \
    requests \
    beautifulsoup4 \
    lxml \
    pyyaml \
    jinja2 \
    cryptography \
    pycryptodome \
    paramiko \
    scapy \
    dnspython \
    pyopenssl \
    python-whois \
    python-nmap \
    selenium \
    playwright

# Create non-root user for code execution
RUN useradd -m -u 1000 -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown -R sandbox:sandbox /workspace

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

# Set Python to unbuffered mode for immediate output
ENV PYTHONUNBUFFERED=1

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
