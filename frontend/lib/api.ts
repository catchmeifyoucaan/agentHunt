import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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
