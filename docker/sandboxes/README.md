# AgentHunt Sandbox Docker Images

Secure, isolated environments for safe code execution across multiple languages.

## Available Sandboxes

### 🐍 Python (python/)
- **Base**: Python 3.11 slim
- **Pre-installed**: requests, beautifulsoup4, cryptography, selenium, playwright, scapy, dnspython, python-nmap
- **Use case**: Python security scripts, web scraping, network analysis
- **Image**: `agenthunt-sandbox-python:latest`

### 🟢 Node.js (node/)
- **Base**: Node.js 20 slim
- **Pre-installed**: axios, cheerio, puppeteer, playwright, jsonwebtoken, bcrypt, ssh2, node-nmap
- **TypeScript**: ts-node and TypeScript compiler included
- **Use case**: JavaScript/TypeScript security scripts, web automation, API testing
- **Image**: `agenthunt-sandbox-node:latest`

### 🔵 Go (go/)
- **Base**: Go 1.21 Alpine
- **Pre-installed**: nuclei, subfinder, httpx, dnsx, httprobe, waybackurls
- **Use case**: Go security tools, high-performance scanners
- **Image**: `agenthunt-sandbox-go:latest`

### 💻 Bash (bash/)
- **Base**: Ubuntu 22.04
- **Pre-installed**: curl, wget, git, jq, nmap, netcat, dnsutils, openssl
- **Use case**: Bash scripts, CLI automation, network utilities
- **Image**: `agenthunt-sandbox-bash:latest`

### 🛠️ Security Tools (tools/)
- **Base**: Kali Linux Rolling
- **Pre-installed**: nmap, masscan, sqlmap, nikto, metasploit, nuclei, subfinder, httpx, katana, gobuster, ffuf
- **Use case**: Comprehensive security testing with industry-standard tools
- **Image**: `agenthunt-sandbox-tools:latest`

## Building Images

### Build all images
```bash
cd docker/sandboxes
docker-compose build
```

### Build individual image
```bash
# Python
docker build -t agenthunt-sandbox-python:latest python/

# Node.js
docker build -t agenthunt-sandbox-node:latest node/

# Go
docker build -t agenthunt-sandbox-go:latest go/

# Bash
docker build -t agenthunt-sandbox-bash:latest bash/

# Security Tools
docker build -t agenthunt-sandbox-tools:latest tools/
```

## Security Features

All sandboxes include:

✅ **Non-root execution**: Code runs as unprivileged user (UID 1000)
✅ **Resource limits**: CPU and memory limits enforced by Docker
✅ **Network isolation**: Configurable network access (default: no network)
✅ **Read-only root**: Optional read-only filesystem
✅ **Capability dropping**: Minimal Linux capabilities
✅ **Seccomp profiles**: Optional security compute mode profiles
✅ **Auto-cleanup**: Containers are automatically removed after execution (configurable)
✅ **Timeout enforcement**: Maximum execution time limits
✅ **Code validation**: Pre-execution safety checks

## Usage

The sandbox executor automatically manages these containers. No manual intervention required.

### Example: Execute Python code
```typescript
import sandboxExecutor from '../services/sandbox/sandbox-executor';

const result = await sandboxExecutor.quickExecute(
  'print("Hello from sandbox!")',
  'python'
);

console.log(result.stdout); // "Hello from sandbox!"
```

### Example: Execute with dependencies
```typescript
const result = await sandboxExecutor.execute({
  code: `
    import requests
    r = requests.get('https://httpbin.org/json')
    print(r.json())
  `,
  config: {
    language: 'python',
    allowNetwork: true,
    dependencies: ['requests'],
    timeoutMs: 10000,
  }
});
```

### Example: Persistent container for multiple executions
```typescript
// First execution creates container
const result1 = await sandboxExecutor.execute({
  code: 'import numpy as np; print(np.version.version)',
  config: {
    language: 'python',
    persistFiles: true,
    dependencies: ['numpy'],
    agentId: 'agent-123',
  }
});

// Second execution reuses same container (faster)
const result2 = await sandboxExecutor.execute({
  code: 'import numpy as np; print(np.random.rand(5))',
  config: {
    language: 'python',
    persistFiles: true,
    agentId: 'agent-123',
  }
});
```

## Resource Monitoring

All executions are monitored in real-time:

- **CPU usage**: Percentage and total time
- **Memory usage**: Current and peak MB
- **Network I/O**: Bytes sent/received (if network enabled)
- **Block I/O**: Disk read/write bytes
- **Execution time**: Total time from start to finish

## Cleanup Policy

Containers are automatically cleaned up based on:

- **Idle time**: 5 minutes (default)
- **Max age**: 1 hour (default)
- **Max containers**: 50 (default)
- **Persistent TTL**: 24 hours (default)

Configure cleanup policy when initializing the executor.

## Fallback Images

If custom images are not built, the system automatically falls back to:

- Python: `python:3.11-slim`
- Node: `node:20-slim`
- Go: `golang:1.21-alpine`
- Bash: `ubuntu:22.04`
- Tools: Not available (must be built)

## Development

### Adding a new language

1. Create directory: `docker/sandboxes/{language}/`
2. Add Dockerfile with security hardening
3. Add service to `docker-compose.yml`
4. Update `docker-manager.ts` image map
5. Add language to `types.ts` SandboxLanguage
6. Add execution command to `sandbox-executor.ts`

### Testing images

```bash
# Test Python sandbox
docker run --rm agenthunt-sandbox-python:latest python -c "import sys; print(sys.version)"

# Test Node sandbox
docker run --rm agenthunt-sandbox-node:latest node -e "console.log(process.version)"

# Test Go sandbox
docker run --rm agenthunt-sandbox-go:latest go version
```

## Troubleshooting

### Image not found
Build the images first using docker-compose or docker build commands above.

### Permission denied
Ensure Docker daemon is running and your user has Docker permissions.

### Container startup timeout
Check Docker daemon resources (CPU/memory). Increase Docker daemon limits if needed.

### Dependency installation fails
Check network connectivity if dependencies require internet access. Enable network in config.

---

**Security Notice**: These sandboxes are designed for controlled security testing environments. Always follow responsible disclosure practices and obtain proper authorization before testing targets.
