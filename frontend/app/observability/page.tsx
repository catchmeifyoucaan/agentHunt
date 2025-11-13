'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { observabilityApi, PHOENIX_URL } from '@/lib/api';
import {
  Activity,
  Clock,
  TrendingUp,
  Zap,
  AlertCircle,
  CheckCircle,
  XCircle,
  DollarSign,
  Search,
  Filter,
  BarChart3,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';

interface Trace {
  id: string;
  name: string;
  duration: number;
  startTime: string;
  status: 'ok' | 'error';
  spans: Span[];
  attributes: Record<string, any>;
}

interface Span {
  id: string;
  name: string;
  duration: number;
  startTime: string;
  endTime: string;
  status: 'ok' | 'error';
  attributes: Record<string, any>;
  events: SpanEvent[];
}

interface SpanEvent {
  name: string;
  timestamp: string;
  attributes: Record<string, any>;
}

interface Metrics {
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
  totalCost: number;
  tokensUsed: number;
  agentExecutions: number;
  toolExecutions: number;
  llmCalls: number;
}

export default function ObservabilityPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [timeRange, setTimeRange] = useState('1h');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [phoenixAvailable, setPhoenixAvailable] = useState(false);

  useEffect(() => {
    checkPhoenixHealth();
    fetchMetrics();
    fetchTraces();
    const interval = setInterval(() => {
      fetchMetrics();
      fetchTraces();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [timeRange]);

  const checkPhoenixHealth = async () => {
    try {
      const response = await observabilityApi.getHealth();
      setPhoenixAvailable(response.data.phoenixAvailable);
    } catch (error) {
      setPhoenixAvailable(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await observabilityApi.getMetrics({ timeRange });
      setMetrics(response.data);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      // Set empty metrics if fetch fails
      setMetrics({
        totalTraces: 0,
        avgDuration: 0,
        errorRate: 0,
        totalCost: 0,
        tokensUsed: 0,
        agentExecutions: 0,
        toolExecutions: 0,
        llmCalls: 0,
      });
    }
  };

  const fetchTraces = async () => {
    try {
      setLoading(true);
      const response = await observabilityApi.getTraces({ timeRange, limit: 50 });
      setTraces(response.data.traces || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch traces:', error);
      setTraces([]);
      setLoading(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const openPhoenix = () => {
    window.open(PHOENIX_URL, '_blank', 'noopener,noreferrer');
  };

  const filteredTraces = traces.filter((trace) =>
    trace.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    trace.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const hasData = traces.length > 0 || (metrics && metrics.totalTraces > 0);

  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Activity className="w-8 h-8 text-purple-600" />
            Observability & Tracing
          </h1>
          <p className="text-sm md:text-base text-gray-600 mt-2">
            Real-time monitoring of agent executions, traces, and performance metrics
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Button onClick={() => { fetchMetrics(); fetchTraces(); }} variant="outline" size="lg">
            <RefreshCw className="w-5 h-5 mr-2" />
            Refresh
          </Button>
          <Button onClick={openPhoenix} size="lg" className="bg-purple-600 hover:bg-purple-700">
            <ExternalLink className="w-5 h-5 mr-2" />
            Open Phoenix UI
          </Button>
        </div>
      </div>

      {/* Phoenix Status Banner */}
      {!phoenixAvailable && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-900">Phoenix Not Available</h3>
                <p className="text-sm text-yellow-700 mt-1">
                  The Phoenix observability platform is not reachable at <code className="bg-yellow-100 px-1 rounded">{PHOENIX_URL}</code>.
                  Trace data will appear once Phoenix is running and jobs are executed.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Traces</CardTitle>
              <Activity className="h-4 w-4 text-gray-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(metrics.totalTraces || 0).toLocaleString()}</div>
              <p className="text-xs text-gray-600 mt-1">Last {timeRange}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
              <Clock className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatDuration(metrics.avgDuration || 0)}</div>
              <p className="text-xs text-gray-600 mt-1">Per execution</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(metrics.errorRate || 0).toFixed(2)}%</div>
              <p className="text-xs text-gray-600 mt-1">Failed traces</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCost(metrics.totalCost || 0)}</div>
              <p className="text-xs text-gray-600 mt-1">{(metrics.tokensUsed || 0).toLocaleString()} tokens</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Time Range Selector */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Traces ({filteredTraces.length})</CardTitle>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 sm:flex-initial sm:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search traces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="15m">Last 15 minutes</option>
                <option value="1h">Last hour</option>
                <option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 text-purple-600 animate-spin" />
              <span className="ml-3 text-gray-600">Loading traces...</span>
            </div>
          ) : !hasData ? (
            <div className="text-center py-12">
              <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Traces Yet</h3>
              <p className="text-gray-600 mb-4">
                Traces will appear here once you start running jobs.
              </p>
              <p className="text-sm text-gray-500">
                Visit the Jobs page to create and execute security testing jobs.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTraces.map((trace) => (
                <div
                  key={trace.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => setSelectedTrace(trace)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {trace.status === 'ok' ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-500" />
                        )}
                        <span className="font-semibold text-gray-900">{trace.name}</span>
                        <Badge variant={trace.status === 'ok' ? 'default' : 'destructive'}>
                          {trace.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {formatDuration(trace.duration)}
                        </div>
                        <div>ID: {trace.id.substring(0, 8)}...</div>
                        {trace.attributes?.['agent.type'] && (
                          <div>Agent: {trace.attributes['agent.type']}</div>
                        )}
                        {trace.attributes?.['job.id'] && (
                          <div>Job: {trace.attributes['job.id'].substring(0, 8)}...</div>
                        )}
                      </div>
                      {trace.spans && trace.spans.length > 0 && (
                        <div className="mt-2 text-sm text-gray-500">
                          {trace.spans.length} span{trace.spans.length !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Trace Details */}
      {selectedTrace && (
        <Card className="border-2 border-purple-200">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Trace Details: {selectedTrace.name}</CardTitle>
                <CardDescription>ID: {selectedTrace.id}</CardDescription>
              </div>
              <Button onClick={() => setSelectedTrace(null)} variant="outline" size="sm">
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Duration</div>
                  <div className="text-lg font-semibold">{formatDuration(selectedTrace.duration)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Status</div>
                  <Badge variant={selectedTrace.status === 'ok' ? 'default' : 'destructive'}>
                    {selectedTrace.status}
                  </Badge>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Started</div>
                  <div className="text-sm">{new Date(selectedTrace.startTime).toLocaleString()}</div>
                </div>
              </div>

              {selectedTrace.attributes && Object.keys(selectedTrace.attributes).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Attributes</h4>
                  <div className="bg-gray-50 rounded p-3 space-y-1">
                    {Object.entries(selectedTrace.attributes).map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <span className="text-gray-600">{key}:</span> <span className="font-mono">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedTrace.spans && selectedTrace.spans.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Spans ({selectedTrace.spans.length})</h4>
                  <div className="space-y-2">
                    {selectedTrace.spans.map((span) => (
                      <div key={span.id} className="border border-gray-200 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{span.name}</span>
                          <span className="text-sm text-gray-600">{formatDuration(span.duration)}</span>
                        </div>
                        {span.attributes && Object.keys(span.attributes).length > 0 && (
                          <div className="text-xs text-gray-600 space-y-1 mt-2">
                            {Object.entries(span.attributes).map(([key, value]) => (
                              <div key={key}>
                                <span className="text-gray-500">{key}:</span> {String(value)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>About OpenTelemetry & Phoenix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          <p>
            AgentHunt uses OpenTelemetry to instrument all agent executions, tool calls, and AI interactions.
            Phoenix provides a powerful web interface for exploring traces and analyzing performance.
          </p>
          <p>
            Click <strong>"Open Phoenix UI"</strong> to access the full Phoenix dashboard with advanced filtering,
            time-series charts, LLM cost analysis, and detailed span trees.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
