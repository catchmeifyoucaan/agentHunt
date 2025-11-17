import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
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
};

// Jobs API
export const jobsApi = {
  list: (params?: any) => api.get('/jobs', { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  getEvents: (id: string, params?: any) => api.get(`/jobs/${id}/events`, { params }),
  create: (data: any) => api.post('/jobs', data),
  cancel: (id: string) => api.post(`/jobs/${id}/cancel`),
  retry: (id: string) => api.post(`/jobs/${id}/retry`),
  getQueueStats: () => api.get('/jobs/stats/queues'),
  getStats: () => api.get('/jobs/stats'),
};

// Manager AI API
export const managerApi = {
  sendCommand: (data: { command: string; program_id?: string; user_id: string }) =>
    api.post('/manager/command', data),
  getHistory: (params?: any) => api.get('/manager/history', { params }),
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

// Dashboard API
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
  getRecentHandoffs: (limit = 10) => api.get(`/dashboard/recent-handoffs?limit=${limit}`),
};

// Export URLs for use in components
export { PHOENIX_URL };
