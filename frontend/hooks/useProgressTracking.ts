'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000';

export interface ProgressStep {
  sequence: number;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface JobProgress {
  jobId: string;
  phase: string;
  steps: ProgressStep[];
  currentStep: number;
  estimatedCompletion?: string;
  overallProgress: number;
}

export interface AgentHealth {
  agentType: string;
  instanceId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  metrics: {
    jobsProcessed: number;
    jobsFailed: number;
    avgDuration: number;
    memoryUsage: number;
    cpuUsage: number;
    errorRate: number;
  };
  lastHeartbeat: string;
  issues?: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
}

export interface WorkflowProgress {
  executionId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: number;
  totalSteps: number;
  startTime: string;
  endTime?: string;
}

/**
 * Hook to connect to progress tracking WebSocket
 */
export function useProgressTracking() {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [jobProgress, setJobProgress] = useState<Map<string, JobProgress>>(new Map());
  const [agentHealth, setAgentHealth] = useState<Map<string, AgentHealth>>(new Map());
  const [workflowProgress, setWorkflowProgress] = useState<Map<string, WorkflowProgress>>(new Map());
  const reconnectTimeout = useRef<NodeJS.Timeout>();
  const subscriptions = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    try {
      ws.current = new WebSocket(`${WS_URL}/ws`);

      ws.current.onopen = () => {
        console.log('Progress tracking WebSocket connected');
        setIsConnected(true);

        // Resubscribe to all channels
        subscriptions.current.forEach((channel) => {
          ws.current?.send(JSON.stringify({
            type: 'subscribe',
            channel
          }));
        });
      };

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'job:progress') {
            setJobProgress((prev) => {
              const updated = new Map(prev);
              updated.set(message.data.jobId, message.data);
              return updated;
            });
          } else if (message.type === 'agent:health') {
            setAgentHealth((prev) => {
              const updated = new Map(prev);
              const key = `${message.data.agentType}:${message.data.instanceId}`;
              updated.set(key, message.data);
              return updated;
            });
          } else if (message.type === 'workflow:progress') {
            setWorkflowProgress((prev) => {
              const updated = new Map(prev);
              updated.set(message.data.executionId, message.data);
              return updated;
            });
          }
        } catch (error) {
          console.error('Failed to parse progress message:', error);
        }
      };

      ws.current.onerror = (error) => {
        console.error('Progress WebSocket error:', error);
      };

      ws.current.onclose = () => {
        console.log('Progress WebSocket disconnected');
        setIsConnected(false);

        // Reconnect after 3 seconds
        reconnectTimeout.current = setTimeout(() => {
          console.log('Attempting to reconnect progress tracking...');
          connect();
        }, 3000);
      };
    } catch (error) {
      console.error('Failed to connect progress WebSocket:', error);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback((channel: string) => {
    subscriptions.current.add(channel);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'subscribe',
        channel
      }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    subscriptions.current.delete(channel);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'unsubscribe',
        channel
      }));
    }
  }, []);

  return {
    isConnected,
    jobProgress,
    agentHealth,
    workflowProgress,
    subscribe,
    unsubscribe
  };
}

/**
 * Hook to track progress for a specific job
 */
export function useJobProgress(jobId: string | undefined) {
  const { isConnected, jobProgress, subscribe, unsubscribe } = useProgressTracking();

  useEffect(() => {
    if (jobId) {
      subscribe(`job:${jobId}:progress`);
      return () => unsubscribe(`job:${jobId}:progress`);
    }
  }, [jobId, subscribe, unsubscribe]);

  return {
    isConnected,
    progress: jobId ? jobProgress.get(jobId) : undefined
  };
}

/**
 * Hook to track all agent health
 */
export function useAgentHealth() {
  const { isConnected, agentHealth, subscribe, unsubscribe } = useProgressTracking();

  useEffect(() => {
    subscribe('agent:*:health');
    return () => unsubscribe('agent:*:health');
  }, [subscribe, unsubscribe]);

  return {
    isConnected,
    agents: Array.from(agentHealth.values())
  };
}

/**
 * Hook to track workflow execution
 */
export function useWorkflowProgress(executionId: string | undefined) {
  const { isConnected, workflowProgress, subscribe, unsubscribe } = useProgressTracking();

  useEffect(() => {
    if (executionId) {
      subscribe(`workflow:${executionId}:progress`);
      return () => unsubscribe(`workflow:${executionId}:progress`);
    }
  }, [executionId, subscribe, unsubscribe]);

  return {
    isConnected,
    progress: executionId ? workflowProgress.get(executionId) : undefined
  };
}
