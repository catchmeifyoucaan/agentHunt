import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const PHOENIX_URL = process.env.NEXT_PUBLIC_PHOENIX_URL || 'http://165.227.108.120:6006';

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Programs API
export const programsApi = {
  list: () => api.get('/programs'),
  get: (id: string) => api.get(`/programs/${id}`),
  create: (data: any) => api.post('/programs', data),
  update: (id: string, data: any) => api.put(`/programs/${id}`, data),
  delete: (id: string) => api.delete(`/programs/${id}`),
  getAssets: (id: string, params?: any) => api.get(`/programs/${id}/assets`, { params }),
  getFindings: (id: string, params?: any) => api.get(`/programs/${id}/findings`, { params }),
  getStats: (id: string) => api.get(`/programs/${id}/stats`),
  pause: (id: string) => api.post(`/programs/${id}/pause`),
  resume: (id: string) => api.post(`/programs/${id}/resume`),
};

// Jobs API
export const jobsApi = {
  list: (params?: any) => api.get('/jobs', { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  getEvents: (id: string, params?: any) => api.get(`/jobs/${id}/events`, { params }),
  create: (data: any) => api.post('/jobs', data),
  cancel: (id: string) => api.post(`/jobs/${id}/cancel`),
  retry: (id: string) => api.post(`/jobs/${id}/retry`),
  requeue: (id: string) => api.post(`/jobs/${id}/requeue`),
  getQueueStats: () => api.get('/jobs/stats/queues'),
  getStats: () => api.get('/jobs/stats'),
  getLogsStream: (id: string) => `${API_URL}/api/v1/jobs/${id}/logs/stream`,
  getHandoffs: (id: string) => api.get(`/jobs/${id}/handoffs`),
  getTurns: (id: string) => api.get(`/jobs/${id}/turns`),
  getActiveJobs: () => api.get('/jobs/active'),
};

// Manager AI API
export const managerApi = {
  sendCommand: (data: { command: string; program_id?: string; user_id: string }) =>
    api.post('/manager/command', data),
  getHistory: (params?: any) => api.get('/manager/history', { params }),
  getPendingApprovals: (userId?: string) => api.get('/manager/approvals/pending', { params: { userId } }),
  approve: (requestId: string, userId: string, comments?: string) =>
    api.post(`/manager/approvals/${requestId}/approve`, { user_id: userId, comments }),
  reject: (requestId: string, userId: string, reason?: string) =>
    api.post(`/manager/approvals/${requestId}/reject`, { user_id: userId, reason }),
  getPerformanceBottlenecks: (programId?: string) =>
    api.get('/manager/performance/bottlenecks', { params: { programId } }),
  getAgentAvailability: (agentType: string) =>
    api.get(`/manager/performance/availability/${agentType}`),
};

// Findings API (extended)
export const findingsApi = {
  list: (params?: any) => api.get('/findings', { params }),
  get: (id: string) => api.get(`/findings/${id}`),
  update: (id: string, data: any) => api.put(`/findings/${id}`, data),
  markAs: (id: string, status: string) => api.post(`/findings/${id}/status`, { status }),
};

// Users API (multi-tenancy)
export const usersApi = {
  list: (params?: any) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
};

// Organizations API (multi-tenancy)
export const organizationsApi = {
  list: () => api.get('/organizations'),
  get: (id: string) => api.get(`/organizations/${id}`),
  create: (data: any) => api.post('/organizations', data),
  update: (id: string, data: any) => api.put(`/organizations/${id}`, data),
};

// Platform Integrations API
export const integrationsApi = {
  hackerOne: {
    sync: (programId: string) => api.post(`/integrations/hackerone/sync/${programId}`),
    getPrograms: () => api.get('/integrations/hackerone/programs'),
  },
  bugcrowd: {
    sync: (programId: string) => api.post(`/integrations/bugcrowd/sync/${programId}`),
    getPrograms: () => api.get('/integrations/bugcrowd/programs'),
  },
  chaos: {
    getPrograms: () => api.get('/integrations/chaos/programs'),
    importProgram: (programName: string) => api.post(`/integrations/chaos/import/${programName}`),
  },
};

// Settings API
export const settingsApi = {
  get: () => api.get('/settings'),
  update: (settings: any) => api.put('/settings', { settings }),
  getStatus: () => api.get('/settings/status'),
};

// Health check
export const healthApi = {
  check: () => axios.get(`${API_URL}/health`),
};

// Observability API (Phoenix integration)
export const observabilityApi = {
  getTraces: (params?: any) => api.get('/observability/traces', { params }),
  getTrace: (traceId: string) => api.get(`/observability/traces/${traceId}`),
  getMetrics: (params?: any) => api.get('/observability/metrics', { params }),
  getHealth: () => api.get('/observability/health'),
  getStats: (params?: any) => api.get('/observability/stats', { params }),
  getExecutions: (params?: any) => api.get('/observability/executions', { params }),
};

// Certificate Monitor API
export const certMonitorApi = {
  start: () => api.post('/cert-monitor/start'),
  stop: () => api.post('/cert-monitor/stop'),
  addDomain: (domain: string, programId: string) => api.post('/cert-monitor/domains', { domain, programId }),
  removeDomain: (domain: string) => api.delete(`/cert-monitor/domains/${domain}`),
  getDomains: () => api.get('/cert-monitor/domains'),
  getStatistics: () => api.get('/cert-monitor/statistics'),
  checkDomain: (domain: string) => api.post(`/cert-monitor/check/${domain}`),
};

// Knowledge Base API
export const knowledgeApi = {
  getStats: (params?: any) => api.get('/knowledge/stats', { params }),
  getDiscoveries: (params?: any) => api.get('/knowledge/discoveries', { params }),
  getStrategies: (params?: any) => api.get('/knowledge/strategies', { params }),
  getMetadata: (params?: any) => api.get('/knowledge/metadata', { params }),
  research: (vulnerability: string, type?: string) =>
    api.post('/knowledge/research', { vulnerability, type }),
  store: (discovery: any) => api.post('/knowledge/store', { discovery }),
  getSimilar: (query: string, limit?: number) =>
    api.get('/knowledge/similar', { params: { query, limit } }),
};

// Patterns API
export const patternsApi = {
  list: (params?: any) => api.get('/patterns', { params }),
  get: (name: string) => api.get(`/patterns/${name}`),
  execute: (name: string, programId: string, options?: any) =>
    api.post(`/patterns/${name}/execute`, { programId, options }),
  getExecutions: (params?: any) => api.get('/patterns/executions/history', { params }),
  getRecommendations: (programId: string) => api.get(`/patterns/recommendations/${programId}`),
  getStatistics: () => api.get('/patterns/statistics/usage'),
};

// Agent Graph API
export const agentGraphApi = {
  orchestrate: (programId: string) => api.post('/agent-graph/orchestrate', { programId }),
  getStatistics: () => api.get('/agent-graph/statistics'),
  export: () => api.get('/agent-graph/export'),
  getAgents: () => api.get('/agent-graph/agents'),
  getAgent: (id: string) => api.get(`/agent-graph/agents/${id}`),
  getKnowledge: () => api.get('/agent-graph/knowledge'),
  getDiscoveries: (params: { target: string; type?: string; limit?: number }) =>
    api.get('/agent-graph/discoveries', { params }),
  getStrategies: (params: { type: string; limit?: number }) =>
    api.get('/agent-graph/strategies', { params }),
  initialize: () => api.post('/agent-graph/initialize'),
};

// Workflow Tracing API
export const workflowTracingApi = {
  getChain: (jobId: string) => api.get(`/workflow-tracing/chains/${jobId}`),
  getWorkflows: (programId: string) => api.get(`/workflow-tracing/programs/${programId}/workflows`),
  getStats: (jobId: string) => api.get(`/workflow-tracing/stats/${jobId}`),
  search: (rootJobId: string, params?: { type?: string; status?: string; limit?: number }) =>
    api.get(`/workflow-tracing/search/${rootJobId}`, { params }),
  getLineage: (jobId: string) => api.get(`/workflow-tracing/lineage/${jobId}`),
};

// Migrations API
export const migrationsApi = {
  getStatus: () => api.get('/migrations/status'),
  runMigrations: () => api.post('/migrations/run'),
};

// Dashboard API
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
  getRecentHandoffs: (limit = 10) => api.get(`/dashboard/recent-handoffs?limit=${limit}`),
  getHandoffChain: (programId?: string, rootJobId?: string) =>
    api.get('/dashboard/handoff-chain', { params: { programId, rootJobId } }),
};

// Export URLs for use in components
export { PHOENIX_URL };
