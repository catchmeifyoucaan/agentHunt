'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Loader2,
  GitBranch,
  Clock,
} from 'lucide-react';
import { useWorkflowProgress } from '@/hooks/useProgressTracking';

interface Workflow {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  trigger: any;
  errorHandling: any;
  metadata: any;
  createdAt: string;
}

interface WorkflowExecution {
  id: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: number;
  totalSteps: number;
  startTime: string;
  endTime?: string;
  context: any;
}

export function WorkflowManager() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const response = await fetch('/api/v1/workflows');
      if (response.ok) {
        const data = await response.json();
        setWorkflows(data);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchExecutions = async () => {
    try {
      const response = await fetch('/api/v1/workflows/executions?limit=10');
      if (response.ok) {
        const data = await response.json();
        setExecutions(data);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    }
  };

  const toggleWorkflow = async (name: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/v1/workflows/${name}/enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (response.ok) {
        fetchWorkflows();
      }
    } catch (error) {
      console.error('Failed to toggle workflow:', error);
    }
  };

  const executeWorkflow = async (name: string) => {
    try {
      const response = await fetch(`/api/v1/workflows/${name}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: {} }),
      });
      if (response.ok) {
        const { executionId } = await response.json();
        console.log('Workflow execution started:', executionId);
        fetchExecutions();
      }
    } catch (error) {
      console.error('Failed to execute workflow:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Registered Workflows */}
      <Card>
        <CardHeader>
          <CardTitle>Registered Workflows</CardTitle>
          <CardDescription>
            Declarative multi-agent workflows with automatic triggers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No workflows registered
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <GitBranch className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{workflow.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {workflow.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={workflow.enabled ? 'default' : 'secondary'}>
                        {workflow.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      <Badge variant="outline">v{workflow.version}</Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={workflow.enabled ? 'outline' : 'default'}
                      onClick={() => toggleWorkflow(workflow.name, workflow.enabled)}
                    >
                      {workflow.enabled ? (
                        <>
                          <Pause className="w-3 h-3 mr-1" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 mr-1" />
                          Enable
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => executeWorkflow(workflow.name)}
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Execute Now
                    </Button>
                  </div>

                  {workflow.trigger && (
                    <div className="text-xs text-muted-foreground">
                      Trigger: {workflow.trigger.on || 'Manual'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Executions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Executions</CardTitle>
          <CardDescription>
            Last 10 workflow executions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No executions yet
            </div>
          ) : (
            <div className="space-y-3">
              {executions.map((execution) => (
                <WorkflowExecutionCard
                  key={execution.id}
                  execution={execution}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowExecutionCard({ execution }: { execution: WorkflowExecution }) {
  const { progress } = useWorkflowProgress(execution.id);

  const Icon =
    execution.status === 'completed'
      ? CheckCircle2
      : execution.status === 'failed'
      ? XCircle
      : Loader2;

  const iconColor =
    execution.status === 'completed'
      ? 'text-green-500'
      : execution.status === 'failed'
      ? 'text-red-500'
      : 'text-blue-500';

  const progressPercent = (execution.currentStep / execution.totalSteps) * 100;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            className={`w-4 h-4 ${iconColor} ${
              execution.status === 'running' ? 'animate-spin' : ''
            }`}
          />
          <span className="font-medium text-sm">{execution.workflowName}</span>
        </div>
        <Badge
          variant={
            execution.status === 'completed'
              ? 'default'
              : execution.status === 'failed'
              ? 'destructive'
              : 'secondary'
          }
        >
          {execution.status}
        </Badge>
      </div>

      {execution.status === 'running' && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              Step {execution.currentStep} of {execution.totalSteps}
            </span>
            <span>{progressPercent.toFixed(0)}%</span>
          </div>
          <Progress value={progressPercent} className="h-1" />
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {new Date(execution.startTime).toLocaleString()}
        </div>
        {execution.endTime && (
          <div>
            Duration:{' '}
            {(
              (new Date(execution.endTime).getTime() -
                new Date(execution.startTime).getTime()) /
              1000
            ).toFixed(1)}
            s
          </div>
        )}
      </div>
    </div>
  );
}
