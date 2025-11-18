'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jobsApi, PHOENIX_URL } from '@/lib/api';
import { LiveTerminal } from '@/components/LiveTerminal';
import { JobCommandViewer } from '@/components/JobCommandViewer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Play,
  Pause,
  Trash2,
  RotateCcw,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Brain,
  Zap,
  ArrowRight,
  Terminal,
  Activity,
  GitBranch,
  Eye,
  ExternalLink,
} from 'lucide-react';
import { getAgentMetadata } from '@/lib/agentMetadata';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useEventStream } from '@/hooks/useWebSocket';

// Types for Turn/Interaction/Action hierarchy (Phase 1.2 + Phase 2.3)
interface Action {
  id: string;
  tool: string;
  command: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  exitCode?: number;
  output?: string;
  status: 'running' | 'completed' | 'failed';
}

interface Interaction {
  id: string;
  reasoning: {
    prompt: string;
    response: string;
    model: string;
    tokens: number;
    cost: number;
  };
  actions: Action[];
  timestamp: string;
}

interface Turn {
  id: string;
  number: number;
  status: 'active' | 'completed' | 'failed';
  interactions: Interaction[];
  startTime: string;
  endTime?: string;
  duration?: number;
}

interface Handoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  reason: string;
  timestamp: string;
  context: Record<string, any>;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobId = params.id as string;
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [expandedInteractions, setExpandedInteractions] = useState<Set<string>>(new Set());

  // Use WebSocket for real-time updates filtered by jobId
  const { events: liveEvents } = useEventStream({ jobId });

  const { data: jobData, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId),
    // No more polling! Real-time via WebSocket
  });

  // Fetch job execution timeline events
  const { data: eventsData } = useQuery({
    queryKey: ['job-events', jobId],
    queryFn: () => jobsApi.getEvents(jobId),
  });

  const { data: handoffsData } = useQuery({
    queryKey: ['job-handoffs', jobId],
    queryFn: () => jobsApi.getHandoffs(jobId),
    enabled: !!jobId, // Only run if jobId is available
  });

  const { data: turnsData } = useQuery({
    queryKey: ['job-turns', jobId],
    queryFn: () => jobsApi.getTurns(jobId),
    enabled: !!jobId, // Only run if jobId is available
  });

  // Listen for WebSocket events and update in real-time
  useEffect(() => {
    if (liveEvents.length > 0) {
      const latestEvent = liveEvents[liveEvents.length - 1];

      // Update job data when status or progress changes
      if (latestEvent.type === 'job_status' || latestEvent.type === 'progress') {
        queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      }

      // Update events timeline when new logs arrive
      if (latestEvent.type === 'log') {
        queryClient.invalidateQueries({ queryKey: ['job-events', jobId] });
      }
    }
  }, [liveEvents, queryClient, jobId]);

  const cancelMutation = useMutation({
    mutationFn: () => jobsApi.cancel(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => jobsApi.retry(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    },
  });

  const requeueMutation = useMutation({
    mutationFn: () => jobsApi.requeue(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    },
  });

  const job = jobData?.data?.job;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading job details...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-16 h-16 mx-auto text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Job Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The job you're looking for doesn't exist or has been deleted.
            </p>
            <Link href="/jobs">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Jobs
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metadata = getAgentMetadata(job.type);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'active':
        return <Play className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-gray-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'active':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const getDuration = () => {
    if (!job.started_at) return 'Not started';
    const start = new Date(job.started_at).getTime();
    const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
    const duration = end - start;

    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  // Toggle turn expansion
  const toggleTurn = (turnId: string) => {
    const newSet = new Set(expandedTurns);
    if (newSet.has(turnId)) {
      newSet.delete(turnId);
    } else {
      newSet.add(turnId);
    }
    setExpandedTurns(newSet);
  };

  // Toggle interaction expansion
  const toggleInteraction = (interactionId: string) => {
    const newSet = new Set(expandedInteractions);
    if (newSet.has(interactionId)) {
      newSet.delete(interactionId);
    } else {
      newSet.add(interactionId);
    }
    setExpandedInteractions(newSet);
  };

  // Format duration in milliseconds
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = seconds / 60;
    return `${minutes.toFixed(1)}m`;
  };

  // Process real events from the API
  const jobEvents = eventsData?.data?.events || [];
  const logEvents = jobEvents.filter((e: any) => e.type === 'log');

  // Group log events by tool for better visualization
  const groupedEvents = logEvents.reduce((acc: any[], event: any) => {
    const lastGroup = acc[acc.length - 1];

    // If same tool as last group, add to that group
    if (lastGroup && lastGroup.tool === event.tool) {
      lastGroup.logs.push(event);
      lastGroup.endTime = event.timestamp;
    } else {
      // Create new group
      acc.push({
        id: event.id,
        tool: event.tool || 'system',
        startTime: event.timestamp,
        endTime: event.timestamp,
        logs: [event],
      });
    }

    return acc;
  }, []);

  // Dynamically get Pattern context from job options
  const patternContext = job.options?.graphAssignment ? {
    name: job.options.patternName || 'Multi-Agent Scan',
    type: job.options.patternType || 'graph_orchestration',
    specialization: job.options.specialization || 'generic',
  } : null;

  // Get OpenTelemetry trace ID from job metadata or fallback to a generated one
  const traceId = job.metadata?.traceId || `trace-${jobId.slice(0, 16)}`;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/jobs">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">Job Details</h1>
              {getStatusIcon(job.status)}
              <Badge className={getStatusColor(job.status)}>{job.status}</Badge>
            </div>
            <p className="text-muted-foreground mt-1">ID: {job.id}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {job.status === 'active' && (
            <Button
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              <Pause className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') && (
            <Button
              variant="outline"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          )}
          {job.status === 'pending' && (
            <Button
              variant="outline"
              onClick={() => requeueMutation.mutate()}
              disabled={requeueMutation.isPending}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Requeue
            </Button>
          )}
        </div>
      </div>

      {/* Job Info Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Job Information</CardTitle>
            <CardDescription>Basic details about this job</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-muted-foreground">Agent Type</label>
              <p className="text-lg">{metadata?.name || job.type}</p>
              {metadata?.description && (
                <p className="text-sm text-muted-foreground mt-1">{metadata.description}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-muted-foreground">Priority</label>
              <div className="flex items-center gap-2 mt-1">
                <div className="h-2 w-24 bg-gray-200 dark:bg-gray-800 rounded-full">
                  <div
                    className="h-2 bg-blue-500 rounded-full"
                    style={{ width: `${(job.priority / 10) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium">{job.priority}/10</span>
              </div>
            </div>

            {job.program_id && (
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Program</label>
                <p className="text-lg">{job.program_id.slice(0, 8)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution Details</CardTitle>
            <CardDescription>Timing and execution information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-muted-foreground">Created</label>
              <p className="text-lg">{formatDate(job.created_at)}</p>
            </div>

            {job.started_at && (
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Started</label>
                <p className="text-lg">{formatDate(job.started_at)}</p>
              </div>
            )}

            {job.completed_at && (
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Completed</label>
                <p className="text-lg">{formatDate(job.completed_at)}</p>
              </div>
            )}

            <div>
              <label className="text-sm font-semibold text-muted-foreground">Duration</label>
              <p className="text-lg">{getDuration()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Card */}
      {job.progress && (
        <Card className="border-blue-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="w-5 h-5 text-blue-500" />
              Tool Progress
            </CardTitle>
            <CardDescription>Real-time progress tracking for running tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Progress Bar */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-semibold">
                  {job.progress.currentTool || 'Processing'}
                </label>
                <span className="text-sm font-mono">
                  {job.progress.current || 0}/{job.progress.total || 0} ({job.progress.percentage || 0}%)
                </span>
              </div>
              <div className="h-3 w-full bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all duration-500 ${
                    job.progress.toolStatus === 'completed'
                      ? 'bg-green-500'
                      : job.progress.toolStatus === 'completed_empty'
                      ? 'bg-yellow-500'
                      : job.progress.toolStatus === 'failed'
                      ? 'bg-red-500'
                      : 'bg-blue-500 animate-pulse'
                  }`}
                  style={{ width: `${job.progress.percentage || 0}%` }}
                />
              </div>
            </div>

            {/* Status Message */}
            {job.progress.message && (
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Status</label>
                <p className="text-base mt-1">{job.progress.message}</p>
              </div>
            )}

            {/* Tool Status Badge */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-muted-foreground">Tool Status:</label>
              <Badge
                className={
                  job.progress.toolStatus === 'running'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : job.progress.toolStatus === 'completed'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : job.progress.toolStatus === 'completed_empty'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                    : job.progress.toolStatus === 'failed'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
                }
              >
                {job.progress.toolStatus || 'unknown'}
              </Badge>
            </div>

            {/* Progress Details */}
            {job.progress.details && Object.keys(job.progress.details).length > 0 && (
              <div>
                <label className="text-sm font-semibold text-muted-foreground mb-2 block">
                  Tool Details
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(job.progress.details).map(([key, value]) => (
                    <div key={key} className="bg-blue-50 dark:bg-blue-950 px-3 py-2 rounded">
                      <label className="text-xs font-semibold text-blue-600 dark:text-blue-400 capitalize">
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </label>
                      <p className="text-sm mt-1 font-mono">
                        {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pattern Context Card */}
      {patternContext && (
        <Card className="border-purple-500 border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-purple-600" />
              Pattern Execution
            </CardTitle>
            <CardDescription>This job is part of a pattern execution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Pattern</label>
                <p className="text-lg font-semibold text-purple-600">{patternContext.name}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Type</label>
                <Badge className="bg-purple-100 text-purple-700 border-purple-200">{patternContext.type}</Badge>
              </div>
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Specialization</label>
                <Badge variant="outline">{patternContext.specialization}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* OpenTelemetry Trace Link */}
      <Card className="border-cyan-500 border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-600" />
            Observability
          </CardTitle>
          <CardDescription>View detailed traces and telemetry data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-semibold text-muted-foreground">Trace ID</label>
              <p className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded mt-1">{traceId}</p>
            </div>
            <div className="flex gap-2">
              <Link href="/observability">
                <Button variant="outline" className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  View in Observability
                </Button>
              </Link>
              <a href={PHOENIX_URL} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Open Phoenix
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Real Execution Timeline */}
      {groupedEvents.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent mb-1">
              Execution Timeline
            </h2>
            <p className="text-sm text-gray-600">Real-time tool execution logs and events</p>
          </div>

          {groupedEvents.map((group: any, index: number) => (
            <Card
              key={group.id}
              className="border-2 border-blue-500 transition-all hover:shadow-lg"
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-cyan-600" />
                    <CardTitle className="flex items-center gap-2">
                      {group.tool}
                    </CardTitle>
                    <Badge className="bg-blue-100 text-blue-800">
                      {group.logs.length} log(s)
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {new Date(group.startTime).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-2">
                {group.logs.map((log: any) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-lg border-l-4 ${
                      log.level === 'error'
                        ? 'bg-red-50 border-red-500'
                        : log.level === 'warn'
                        ? 'bg-yellow-50 border-yellow-500'
                        : log.level === 'debug'
                        ? 'bg-gray-50 border-gray-500'
                        : 'bg-blue-50 border-blue-500'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span
                        className={`text-xs font-semibold uppercase ${
                          log.level === 'error'
                            ? 'text-red-600'
                            : log.level === 'warn'
                            ? 'text-yellow-600'
                            : log.level === 'debug'
                            ? 'text-gray-600'
                            : 'text-blue-600'
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{log.message}</p>
                    {log.context && Object.keys(log.context).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs font-semibold text-gray-600 cursor-pointer">
                          Context
                        </summary>
                        <pre className="text-xs mt-1 p-2 bg-white rounded">
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Handoffs Section */}
      {handoffsData?.data?.handoffs && handoffsData.data.handoffs.length > 0 && (
        <Card className="border-orange-500 border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRight className="w-5 h-5 text-orange-600" />
              Agent Handoffs
            </CardTitle>
            <CardDescription>Agent coordination and work delegation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {handoffsData.data.handoffs.map((handoff: Handoff) => (
                <div key={handoff.id} className="bg-orange-50 border-l-4 border-orange-500 p-4 rounded">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className="bg-gray-100 text-gray-700">{handoff.fromAgent}</Badge>
                    <ArrowRight className="w-4 h-4 text-orange-500" />
                    <Badge className="bg-orange-100 text-orange-700">{handoff.toAgent}</Badge>
                    <span className="text-xs text-gray-500">{formatDate(handoff.timestamp)}</span>
                  </div>
                  <p className="text-sm text-gray-800 mb-2">{handoff.reason}</p>
                  {handoff.context && Object.keys(handoff.context).length > 0 && (
                    <div className="bg-white p-2 rounded text-xs">
                      <label className="font-semibold">Context:</label>
                      <pre className="mt-1">{JSON.stringify(handoff.context, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Turns Section */}
      {turnsData?.data?.turns && turnsData.data.turns.length > 0 && (
        <Card className="border-green-500 border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-green-600" />
              Agent Turns
            </CardTitle>
            <CardDescription>Detailed breakdown of agent thought process and actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {turnsData.data.turns.map((turn: Turn) => (
                <div key={turn.id} className="border rounded-lg p-4 bg-green-50/50">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleTurn(turn.id)}
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      {expandedTurns.has(turn.id) ? <ChevronDown /> : <ChevronRight />}
                      Turn {turn.number} - {turn.status}
                    </h3>
                    <Badge
                      className={
                        turn.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : turn.status === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-blue-100 text-blue-800'
                      }
                    >
                      {turn.status}
                    </Badge>
                  </div>

                  {expandedTurns.has(turn.id) && (
                    <div className="mt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Duration: {formatDuration(turn.duration || 0)}
                      </p>

                      {turn.interactions.map((interaction: Interaction) => (
                        <div key={interaction.id} className="border-l-4 border-blue-300 pl-4 space-y-3">
                          <div
                            className="flex items-center justify-between cursor-pointer"
                            onClick={() => toggleInteraction(interaction.id)}
                          >
                            <h4 className="text-md font-semibold flex items-center gap-2">
                              {expandedInteractions.has(interaction.id) ? <ChevronDown /> : <ChevronRight />}
                              Interaction
                            </h4>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(interaction.timestamp)}
                            </span>
                          </div>

                          {expandedInteractions.has(interaction.id) && (
                            <div className="mt-3 space-y-3">
                              {/* Reasoning */}
                              {interaction.reasoning && (
                                <div className="bg-gray-50 p-3 rounded-md text-sm">
                                  <p className="font-medium mb-1">Reasoning:</p>
                                  <p className="whitespace-pre-wrap">{interaction.reasoning.response}</p>
                                  <div className="text-xs text-muted-foreground mt-2">
                                    Model: {interaction.reasoning.model} | Tokens: {interaction.reasoning.tokens} | Cost: ${interaction.reasoning.cost?.toFixed(5)}
                                  </div>
                                </div>
                              )}

                              {/* Actions */}
                              {interaction.actions && interaction.actions.length > 0 && (
                                <div className="space-y-2">
                                  <p className="font-medium">Actions:</p>
                                  {interaction.actions.map((action: Action) => (
                                    <div key={action.id} className="bg-white p-3 rounded-md border">
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="font-semibold flex items-center gap-1">
                                          <Zap className="w-4 h-4 text-blue-500" />
                                          {action.tool}
                                        </span>
                                        <Badge
                                          className={
                                            action.status === 'completed'
                                              ? 'bg-green-100 text-green-800'
                                              : action.status === 'failed'
                                              ? 'bg-red-100 text-red-800'
                                              : 'bg-blue-100 text-blue-800'
                                          }
                                        >
                                          {action.status}
                                        </Badge>
                                      </div>
                                      <pre className="text-xs mt-2 p-2 bg-gray-100 rounded-md overflow-x-auto">
                                        {action.command}
                                      </pre>
                                      {action.output && (
                                        <details className="mt-2">
                                          <summary className="text-xs font-semibold text-gray-600 cursor-pointer">
                                            Output
                                          </summary>
                                          <pre className="text-xs mt-1 p-2 bg-gray-100 rounded">
                                            {action.output}
                                          </pre>
                                        </details>
                                      )}
                                      {action.duration && (
                                        <p className="text-xs text-muted-foreground mt-2">
                                          Duration: {formatDuration(action.duration)}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Options Card */}
      {job.options && Object.keys(job.options).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Job Options</CardTitle>
            <CardDescription>Configuration parameters for this job</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(job.options).map(([key, value]) => (
                <div key={key}>
                  <label className="text-sm font-semibold text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <p className="text-sm mt-1 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Card */}
      {job.error && (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Error
            </CardTitle>
            <CardDescription>Job execution error</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-red-50 dark:bg-red-950 p-4 rounded-lg text-sm overflow-x-auto">
              {job.error}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Result Card */}
      {job.result && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>Job execution result</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm overflow-x-auto max-h-96">
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Command Details Viewer */}
      <JobCommandViewer job={job} />

      {/* Live Terminal */}
      <LiveTerminal
        jobId={job.id}
        title={`Live Logs - ${metadata?.name || job.type}`}
        height="600px"
      />
    </div>
  );
}
