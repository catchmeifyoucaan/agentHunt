# AgentHunt: Major Improvements Roadmap

This document outlines the strategic improvements for the AgentHunt platform, focusing on enhancing speed, scalability, and the effectiveness of security testing. We will track the implementation of each item here.

## A. Getting Faster (Speed)

- [ ] **1. Parallelize Tool Execution within Agents:** Modify agents that run multiple independent tools sequentially to launch them concurrently using `Promise.all`.
    - [x] `FingerprintAgent`: Parallelize `dnsx` and `httpx` execution.
    - [ ] `DiscoveryAgent`: Identify and parallelize independent tool runs.
- [x] **2. Optimize Tool Flags for Speed:** Review and tune the command-line flags for all key tools (`httpx`, `naabu`, `subfinder`, etc.) to maximize performance. Expose these flags as configurable environment variables.
    - [x] `httpx`: Configurable `threads`, `rate-limit`, `timeout`, and `retries` via environment variables.
- [x] **3. Implement Streaming for Tool Outputs:** Modify the `executeCommand` utility to process `stdout` as a stream, allowing agents to parse results line-by-line as they are produced instead of waiting for the tool to exit.
    - [x] Refactored `executeCommand` in `base.ts` to use `child_process.spawn` and collect output via streams.

## B. Scaling Higher (Scalability)

- [x] **1. Horizontal Scaling of Workers:** Document the procedure for running `agenthunt-workers` on multiple servers to distribute the job load horizontally.
    - [x] **Documentation:**
        To scale workers horizontally across multiple servers, follow these steps:
        1.  **Prerequisites:** Ensure each new server has Node.js, npm, and PM2 installed.
        2.  **Codebase:** Deploy the AgentHunt codebase to each new worker server (e.g., via `git clone` and `git pull`).
        3.  **Environment Configuration:** On each new worker server, create or update the `.env` file to point to the *centralized* Redis and PostgreSQL instances. The `REDIS_HOST`, `REDIS_PORT`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` variables must match your primary database and Redis server.
        4.  **Install Dependencies:** Navigate to the `backend` directory (`cd /opt/agenthunt/backend`) and run `npm install --production`.
        5.  **Start Workers:** From the project root directory (`/opt/agenthunt`), start only the worker processes using PM2:
            ```bash
            pm2 start ecosystem.config.js --only agenthunt-workers
            pm2 save
            ```
        6.  **Verification:** Use `pm2 list` and `pm2 logs agenthunt-workers` on each server to verify that the workers are running and connecting to the queues. Jobs will automatically be distributed among all active worker instances across all servers.
- [x] **2. Introduce Specialized Job Queues:**
    - [x] Created new `AgentType`s (`high-cpu-queue`, `network-io-queue`) in `shared/types/index.ts`.
    - [x] Modified `createWorker` in `backend/src/services/queue.ts` to accept an array of queue names and updated `agentTypes` array.
    - [x] Updated `backend/src/workers/index.ts` to read `WORKER_QUEUES` environment variable for queue subscription.
    - [x] Modified `ecosystem.config.js` to configure specialized worker instances using `WORKER_QUEUES`.
- [x] **3. Implement Database Read Replicas:** Update the database service to support a read replica, directing `SELECT` queries to the replica and `INSERT`/`UPDATE` queries to the primary database to reduce load.
    - [x] Added read replica configuration to `backend/src/config/index.ts`.
    - [x] Modified `Database` class in `backend/src/services/database.ts` to use a `readPool` for `SELECT` queries and updated `healthCheck` and `close` methods.

## C. Getting Doper Results (Effectiveness)

- [x] **1. Create Dynamic, Reactive Workflows (Job Chaining):** Expand the job-triggering pattern (`SubdomainAgent` -> `FingerprintAgent`) into a fully reactive system where an agent's output becomes the trigger and input for the next logical agent.
    - [x] Created `backend/src/services/orchestrator.ts` to manage job chaining.
    - [x] Integrated `orchestrator.onJobComplete` into `backend/src/workers/index.ts` to trigger subsequent jobs.
- [x] **2. Implement Context-Aware Scanning:** Enhance the `ScannerAgent` to use data from the `FingerprintAgent` to dynamically select the most relevant Nuclei templates for a given target, moving from broad scanning to precision-targeted scanning.
    - [x] Updated `ScannerJob` interface in `shared/types/index.ts` to include `fingerprintData`.
    - [x] Modified `getTemplates` in `backend/src/agents/scanner.ts` to use `fingerprintData` for template selection.
    - [x] Updated `Orchestrator` to pass `fingerprintData` when triggering `ScannerJob`.
- [x] **3. Enhance the Manager Agent's Capabilities:**
    - [x] Add capabilities for managing program-specific scanning policies by enhancing `ManagerAgent.updatePolicy` in `backend/src/agents/manager.ts` and refining the `processManagerCommand` prompt in `backend/src/services/ai.ts`.
