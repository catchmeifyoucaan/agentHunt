# Multi-Agent Architecture Improvement Plan

This document outlines the identified improvements from the multi-agent architecture analysis and tracks their implementation status.

**Overall Goal: [x] Implement identified improvements from the multi-agent architecture analysis.**

## 1. Initial Setup & Diagnosis

*   [x] Resolve initial TypeScript error.
*   [x] Diagnose and fix "three-agents" silent failure.
*   [x] Conduct deep analysis of the agent ecosystem.
*   [x] Report findings on agent roles, communication, architecture.
*   [x] Provide improvement suggestions.

## 2. Enhanced Self-Healing

*   [x] **Proactive Monitoring**: Implement a dedicated health-monitor worker that periodically checks the health of all active agents and queues.
*   [x] **Automated Recovery**: If an agent is unresponsive or a queue is backed up, the health monitor will trigger an automated recovery process (e.g., restart the agent, scale up workers).
*   [x] **Manager Agent Integration**: The Manager Agent will have new actions to `restart_worker`, `monitor_queues`, and `scale_workers` to respond to health alerts.

## 3. Dynamic Resource Allocation

*   [x] **Queue Monitoring**: Implement real-time monitoring of BullMQ queues to track job counts (waiting, active, failed).
*   [x] **Dynamic Scaling**: Based on queue metrics, the Manager Agent will dynamically adjust the number of worker instances for specific agent types (e.g., scale up `ScannerAgent` workers if the `scan` queue is growing).
*   [x] **PM2 Integration**: Utilize PM2's API to programmatically scale worker processes up or down.

## 4. Strengthen the Feedback Loop for Learning

*   [x] **Feedback Mechanism**: Implement a structured feedback mechanism where agents can provide feedback on the quality of information received from other agents (e.g., `ConfirmAgent` marking a `ScannerAgent` finding as a false positive).
*   [x] **Knowledge Base Integration**: Store this feedback in a dedicated knowledge base (e.g., a new database table) that can be queried by agents.
*   [x] **Agent Adaptation**: Agents will query the knowledge base to adapt their behavior. For example, the `ScannerAgent` will deprioritize templates that are frequently reported as false positives.
*   [x] **Agent Evolution**: Integrate the feedback loop with the `agent-evolution-integration.ts` service to track and manage agent learning over time.

## 5. Manager Agent UI

*   [x] **New Frontend Page**: Create a new page in the Next.js frontend for the Manager Agent.
*   [x] **Command Interface**: The UI will have a command input for users to send natural language commands to the Manager Agent.
*   [x] **Approval Workflow**: The UI will display pending approval requests for critical operations and allow users to approve or reject them.
*   [x] **Results Display**: The UI will display the results of the Manager Agent's operations in a clear and user-friendly format.

## 6. Granular Configuration

*   [x] **UI for Configuration**: Create a new settings page in the frontend to allow users to configure agent settings.
*   [x] **Agent-Specific Settings**: Expose agent-specific settings, such as Nuclei template sets for the `ScannerAgent`.
*   [x] **Backend API**: Create a new API endpoint to update the agent configurations.
*   [x] **Dynamic Configuration Loading**: Agents will load their configuration dynamically, allowing for changes to be applied without a full restart.

## 7. Next Steps

*   [ ] Await user's next command.
