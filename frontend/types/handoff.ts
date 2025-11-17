export interface Handoff {
  id: string;
  type: string;
  status: 'completed' | 'failed' | 'processing';
  created_at: string;
}
