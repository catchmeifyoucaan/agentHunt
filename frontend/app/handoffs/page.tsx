'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dashboardApi } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, CheckCircle, XCircle, Clock, Loader2, GitBranch, TrendingUp, Eye, X } from 'lucide-react';
import { useEventStream } from '@/hooks/useWebSocket';
import { HandoffDetails } from '@/components/handoff-details';

interface HandoffStats {
  total: number;
  successful: number;
  failed: number;
  inProgress: number;
  overallAvgDurationSeconds: number;
  byFromAgentType: {
    agentType: string;
    count: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDurationSeconds: number;
  }[];
  byToAgentType: {
    agentType: string;
    count: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDurationSeconds: number;
  }[];
}

interface RecentHandoff {
  id: string;
  from_agent_type: string;
  to_agent_type: string;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'failed' | 'circuit_breaker_open';
  created_at: string;
  completed_at?: string;
  rejection_reason?: string;
  to_job_id?: string;
  program_id?: string;
  reasoning: {
    trigger: string;
    confidence: number;
    decisionFactors: string[];
  };
  objectives: {
    primary: string;
    secondary: string[];
  };
  outputContract: {
    format: string;
    requiredFields: string[];
    shouldTriggerNextHandoff: boolean;
  };
  parentResult: any;
}

const HandoffsPage = () => {
  const [stats, setStats] = useState<HandoffStats | null>(null);
  const [recentHandoffs, setRecentHandoffs] = useState<RecentHandoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHandoff, setSelectedHandoff] = useState<RecentHandoff | null>(null);
  const { toast } = useToast();

  // Use WebSocket for real-time updates
  const { events } = useEventStream();
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [statsResponse, handoffsResponse] = await Promise.all([
          dashboardApi.getStats(),
          dashboardApi.getRecentHandoffs(),
        ]);
        setStats(statsResponse.data);
        setRecentHandoffs(Array.isArray(handoffsResponse.data) ? handoffsResponse.data : []);
      } catch (error: any) {
        toast({
          title: 'Error fetching handoff data',
          description: error.message || 'An unknown error occurred',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // No more polling - WebSocket will update in real-time
  }, [toast]);
  
  // Update on WebSocket events
  useEffect(() => {
    const handoffEvent = events.find(e => e.type === 'handoff:status' || e.type === 'program:handoffs');
    if (handoffEvent) {
      // Refetch data when handoff status changes
      const fetchData = async () => {
        try {
          const [statsResponse, handoffsResponse] = await Promise.all([
            dashboardApi.getStats(),
            dashboardApi.getRecentHandoffs(),
          ]);
          setStats(statsResponse.data);
          setRecentHandoffs(Array.isArray(handoffsResponse.data) ? handoffsResponse.data : []);
        } catch (error: any) {
          // Silently fail on WebSocket-triggered updates
        }
      };
      fetchData();
    }
  }, [events]);

  const formatDuration = (seconds: number) => {
    if (seconds === 0) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'accepted':
        return <Badge variant="secondary" className="bg-blue-500 hover:bg-blue-600 text-white">In Progress</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'circuit_breaker_open':
        return <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600">Circuit Open</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="relative h-full">
      <div className="p-4 sm:p-6 lg:p-8 overflow-y-auto h-full">
        <h1 className="text-2xl font-bold mb-6">Handoff Monitoring</h1>

        {loading && !stats ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Overall Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Handoffs</CardTitle>
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.total || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.overallAvgDurationSeconds ? `Avg. Duration: ${formatDuration(stats.overallAvgDurationSeconds)}` : 'N/A'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Successful</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">{stats?.successful || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.total ? `${((stats.successful / stats.total) * 100).toFixed(1)}% success rate` : 'N/A'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Failed</CardTitle>
                  <XCircle className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-500">{stats?.failed || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.total ? `${((stats.failed / stats.total) * 100).toFixed(1)}% failure rate` : 'N/A'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                  <Clock className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-500">{stats?.inProgress || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    Currently being processed by agents
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Handoffs by Agent Type */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Handoffs Initiated By Agent</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent Type</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Success Rate</TableHead>
                        <TableHead>Avg. Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(stats?.byFromAgentType || []).map((agent, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{agent.agentType}</TableCell>
                          <TableCell>{agent.count}</TableCell>
                          <TableCell className={agent.successRate > 0.8 ? 'text-green-500' : agent.successRate < 0.5 ? 'text-red-500' : ''}>
                            {(agent.successRate * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell>{formatDuration(agent.avgDurationSeconds)}</TableCell>
                        </TableRow>
                      ))}
                      {(!stats?.byFromAgentType || stats.byFromAgentType.length === 0) && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Handoffs Received By Agent</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent Type</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Success Rate</TableHead>
                        <TableHead>Avg. Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(stats?.byToAgentType || []).map((agent, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{agent.agentType}</TableCell>
                          <TableCell>{agent.count}</TableCell>
                          <TableCell className={agent.successRate > 0.8 ? 'text-green-500' : agent.successRate < 0.5 ? 'text-red-500' : ''}>
                            {(agent.successRate * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell>{formatDuration(agent.avgDurationSeconds)}</TableCell>
                        </TableRow>
                      ))}
                      {(!stats?.byToAgentType || stats.byToAgentType.length === 0) && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Recent Handoffs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Handoffs</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Objective</TableHead>
                      <TableHead>Output Format</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentHandoffs.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No recent handoffs</TableCell></TableRow>
                    ) : (
                      recentHandoffs.map((handoff) => (
                        <TableRow key={handoff.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900" onClick={() => setSelectedHandoff(handoff)}>
                          <TableCell className="font-mono text-xs">{handoff.id.substring(0, 8)}...</TableCell>
                          <TableCell>{handoff.from_agent_type}</TableCell>
                          <TableCell>{handoff.to_agent_type}</TableCell>
                          <TableCell>{getStatusBadge(handoff.status)}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate" title={handoff.reasoning?.trigger}>
                            {handoff.reasoning?.trigger || 'N/A'}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate" title={handoff.objectives?.primary}>
                            {handoff.objectives?.primary || 'N/A'}
                          </TableCell>
                          <TableCell className="text-sm">{handoff.outputContract?.format || 'N/A'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(handoff.created_at), { addSuffix: true })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedHandoff(handoff); }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Slide-over Details Panel */}
      {selectedHandoff && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm" onClick={() => setSelectedHandoff(null)}>
          <div className="w-full max-w-2xl h-full bg-white dark:bg-slate-950 shadow-2xl p-6 overflow-y-auto border-l animate-in slide-in-from-right duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Handoff Details</h2>
              <Button variant="ghost" size="icon" onClick={() => setSelectedHandoff(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <HandoffDetails handoff={selectedHandoff} />
          </div>
        </div>
      )}
    </div>
  );
};

export default HandoffsPage;
