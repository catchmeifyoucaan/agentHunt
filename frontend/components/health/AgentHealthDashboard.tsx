'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useAgentHealth } from '@/hooks/useProgressTracking';

export function AgentHealthDashboard() {
  const { isConnected, agents } = useAgentHealth();

  const healthyCount = agents.filter((a) => a.status === 'healthy').length;
  const degradedCount = agents.filter((a) => a.status === 'degraded').length;
  const unhealthyCount = agents.filter((a) => a.status === 'unhealthy').length;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Total Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agents.length}</div>
            <p className="text-xs text-muted-foreground">
              {isConnected ? 'Live monitoring' : 'Disconnected'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Healthy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{healthyCount}</div>
            <p className="text-xs text-muted-foreground">Operating normally</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              Degraded
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">{degradedCount}</div>
            <p className="text-xs text-muted-foreground">Performance issues</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              Unhealthy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{unhealthyCount}</div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Agent List */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Status</CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No agents running
            </div>
          ) : (
            <div className="space-y-4">
              {agents.map((agent) => {
                const statusColor =
                  agent.status === 'healthy'
                    ? 'bg-green-500'
                    : agent.status === 'degraded'
                    ? 'bg-yellow-500'
                    : 'bg-red-500';

                const successRate =
                  agent.metrics.jobsProcessed > 0
                    ? (
                        ((agent.metrics.jobsProcessed - agent.metrics.jobsFailed) /
                          agent.metrics.jobsProcessed) *
                        100
                      ).toFixed(1)
                    : '100.0';

                return (
                  <div
                    key={`${agent.agentType}:${agent.instanceId}`}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${statusColor}`} />
                        <div>
                          <div className="font-medium">{agent.agentType}</div>
                          <div className="text-xs text-muted-foreground">
                            {agent.instanceId}
                          </div>
                        </div>
                      </div>
                      <Badge
                        variant={
                          agent.status === 'healthy'
                            ? 'default'
                            : agent.status === 'degraded'
                            ? 'secondary'
                            : 'destructive'
                        }
                      >
                        {agent.status}
                      </Badge>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Jobs Processed</div>
                        <div className="font-medium">{agent.metrics.jobsProcessed}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Success Rate</div>
                        <div className="font-medium flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {successRate}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          Memory
                        </div>
                        <div className="font-medium">
                          {(agent.metrics.memoryUsage / 1024 / 1024).toFixed(0)} MB
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs flex items-center gap-1">
                          <Cpu className="w-3 h-3" />
                          CPU
                        </div>
                        <div className="font-medium">{agent.metrics.cpuUsage.toFixed(1)}%</div>
                      </div>
                    </div>

                    {/* Issues */}
                    {agent.issues && agent.issues.length > 0 && (
                      <div className="space-y-2">
                        {agent.issues.map((issue, idx) => (
                          <Alert
                            key={idx}
                            variant={issue.severity === 'critical' ? 'destructive' : 'default'}
                          >
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              <span className="font-medium">{issue.type}:</span> {issue.message}
                            </AlertDescription>
                          </Alert>
                        ))}
                      </div>
                    )}

                    {/* Last Heartbeat */}
                    <div className="text-xs text-muted-foreground">
                      Last heartbeat: {new Date(agent.lastHeartbeat).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
