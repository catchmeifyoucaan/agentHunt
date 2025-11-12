'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  LineChart,
  PieChart,
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

  useEffect(() => {
    fetchMetrics();
    fetchTraces();
    const interval = setInterval(() => {
      fetchMetrics();
      fetchTraces();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [timeRange]);

  const fetchMetrics = async () => {
    try {
      // Mock data - replace with actual Phoenix API call
      setMetrics({
        totalTraces: 1247,
        avgDuration: 8542,
        errorRate: 2.3,
        totalCost: 0.42,
        tokensUsed: 245678,
        agentExecutions: 3456,
        toolExecutions: 12890,
        llmCalls: 4567,
      });
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  };

  const fetchTraces = async () => {
    try {
      setLoading(true);
      // Mock data - replace with actual Phoenix API call
      const mockTraces: Trace[] = [
        {
          id: 'trace-1',
          name: 'scanner.process',
          duration: 8542,
          startTime: new Date(Date.now() - 8542).toISOString(),
          status: 'ok',
          attributes: {
            'agent.type': 'scanner',
            'job.id': 'job-123',
            'program.id': 'prog-456',
          },
          spans: [
            {
              id: 'span-1',
              name: 'tool.nuclei',
              duration: 8234,
              startTime: new Date(Date.now() - 8542).toISOString(),
              endTime: new Date(Date.now() - 308).toISOString(),
              status: 'ok',
              attributes: {
                'tool.command': 'nuclei',
                'tool.exit_code': 0,
                'tool.templates': 4523,
              },
              events: [],
            },
            {
              id: 'span-2',
              name: 'ai.chat',
              duration: 234,
              startTime: new Date(Date.now() - 308).toISOString(),
              endTime: new Date(Date.now() - 74).toISOString(),
              status: 'ok',
              attributes: {
                'ai.provider': 'gemini',
                'ai.model': 'gemini-1.5-pro',
                'ai.tokens': 1523,
                'ai.cost_usd': 0.0,
              },
              events: [],
            },
          ],
        },
        {
          id: 'trace-2',
          name: 'fingerprint.process',
          duration: 1234,
          startTime: new Date(Date.now() - 15000).toISOString(),
          status: 'ok',
          attributes: {
            'agent.type': 'fingerprint',
            'job.id': 'job-124',
          },
          spans: [],
        },
        {
          id: 'trace-3',
          name: 'discovery.process',
          duration: 3456,
          startTime: new Date(Date.now() - 45000).toISOString(),
          status: 'error',
          attributes: {
            'agent.type': 'discovery',
            'job.id': 'job-125',
          },
          spans: [],
        },
      ];
      setTraces(mockTraces);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch traces:', error);
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

  const filteredTraces = traces.filter((trace) =>
    trace.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    trace.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Observability Dashboard
          </h1>
          <p className="text-gray-600 mt-2">
            Real-time distributed tracing powered by OpenTelemetry + Phoenix
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('http://localhost:6006', '_blank')}
            className="gap-2"
          >
            <Activity className="w-4 h-4" />
            Open Phoenix UI
          </Button>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="5m">Last 5 minutes</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
        </div>
      </div>

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Total Traces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{metrics.totalTraces.toLocaleString()}</div>
              <p className="text-xs text-gray-500 mt-1">In selected time range</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Avg Duration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{formatDuration(metrics.avgDuration)}</div>
              <p className="text-xs text-gray-500 mt-1">Average trace duration</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-red-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Error Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{metrics.errorRate.toFixed(1)}%</div>
              <p className="text-xs text-gray-500 mt-1">Failed traces</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Total Cost
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">{formatCost(metrics.totalCost)}</div>
              <p className="text-xs text-gray-500 mt-1">AI provider costs</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Additional Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-700 font-medium">Agent Executions</p>
                  <p className="text-2xl font-bold text-blue-900 mt-1">
                    {metrics.agentExecutions.toLocaleString()}
                  </p>
                </div>
                <Zap className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-700 font-medium">Tool Executions</p>
                  <p className="text-2xl font-bold text-green-900 mt-1">
                    {metrics.toolExecutions.toLocaleString()}
                  </p>
                </div>
                <BarChart3 className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-700 font-medium">LLM Calls</p>
                  <p className="text-2xl font-bold text-purple-900 mt-1">
                    {metrics.llmCalls.toLocaleString()}
                  </p>
                </div>
                <Activity className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-orange-700 font-medium">Tokens Used</p>
                  <p className="text-2xl font-bold text-orange-900 mt-1">
                    {(metrics.tokensUsed / 1000).toFixed(0)}K
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Traces Explorer */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LineChart className="w-5 h-5" />
                Trace Explorer
              </CardTitle>
              <CardDescription>View and analyze distributed traces in real-time</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search traces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="w-4 h-4" />
                Filters
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-gray-600 mt-4">Loading traces...</p>
            </div>
          ) : filteredTraces.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No traces found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTraces.map((trace) => (
                <div
                  key={trace.id}
                  onClick={() => setSelectedTrace(trace)}
                  className={`p-4 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                    selectedTrace?.id === trace.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      {trace.status === 'ok' ? (
                        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 truncate">{trace.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {trace.spans.length} spans
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(trace.duration)}
                          </span>
                          <span className="truncate">{trace.id}</span>
                          {trace.attributes['agent.type'] && (
                            <Badge variant="secondary" className="text-xs">
                              {trace.attributes['agent.type']}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      {new Date(trace.startTime).toLocaleTimeString()}
                    </div>
                  </div>

                  {/* Span Timeline */}
                  {selectedTrace?.id === trace.id && trace.spans.length > 0 && (
                    <div className="mt-4 space-y-2 pt-4 border-t">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Span Timeline</h4>
                      {trace.spans.map((span, idx) => (
                        <div key={span.id} className="pl-8 relative">
                          <div className="absolute left-2 top-1 w-4 h-4 rounded-full bg-blue-500 border-2 border-white"></div>
                          {idx < trace.spans.length - 1 && (
                            <div className="absolute left-3.5 top-5 w-0.5 h-full bg-blue-200"></div>
                          )}
                          <div className="bg-gray-50 p-3 rounded-md">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">{span.name}</div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDuration(span.duration)}
                                  </span>
                                  {span.attributes['tool.exit_code'] !== undefined && (
                                    <Badge
                                      variant={span.attributes['tool.exit_code'] === 0 ? 'default' : 'destructive'}
                                      className="text-xs"
                                    >
                                      Exit: {span.attributes['tool.exit_code']}
                                    </Badge>
                                  )}
                                  {span.attributes['ai.provider'] && (
                                    <span>Provider: {span.attributes['ai.provider']}</span>
                                  )}
                                  {span.attributes['ai.tokens'] && (
                                    <span>Tokens: {span.attributes['ai.tokens'].toLocaleString()}</span>
                                  )}
                                </div>
                              </div>
                              {span.attributes['ai.cost_usd'] !== undefined && (
                                <div className="text-sm font-semibold text-purple-600">
                                  {formatCost(span.attributes['ai.cost_usd'])}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phoenix Integration Info */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white rounded-lg">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-2">Full Observability with Phoenix</h3>
              <p className="text-sm text-gray-700 mb-4">
                AgentHunt uses OpenTelemetry + Phoenix for complete distributed tracing. Every agent execution, tool
                call, and LLM decision is traced end-to-end with full context propagation.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => window.open('http://localhost:6006', '_blank')}
                  className="gap-2 bg-blue-600 hover:bg-blue-700"
                >
                  <Activity className="w-4 h-4" />
                  Open Phoenix Dashboard
                </Button>
                <Button variant="outline" className="gap-2">
                  <BarChart3 className="w-4 h-4" />
                  View Documentation
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
