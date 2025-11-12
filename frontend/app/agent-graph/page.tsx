'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Network,
  Zap,
  Users,
  TrendingUp,
  Activity,
  Brain,
  GitBranch,
  ArrowRight,
  Play,
  BarChart3,
  Database,
  Target,
  Award,
  Clock,
} from 'lucide-react';

interface AgentNode {
  id: string;
  specialization: string[];
  capacity: number;
  currentLoad: number;
  utilization: number;
  metadata?: any;
}

interface AgentEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
}

interface AgentStats {
  agentId: string;
  specialization: string[];
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  avgDuration: number;
  successRate: number;
  currentLoad: number;
  capacity: number;
}

export default function AgentGraphPage() {
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [edges, setEdges] = useState<AgentEdge[]>([]);
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGraphData();
    fetchAgentStats();
    fetchKnowledgeStats();

    const interval = setInterval(() => {
      fetchGraphData();
      fetchAgentStats();
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const fetchGraphData = async () => {
    try {
      const response = await fetch('/api/agent-graph/agents');
      const data = await response.json();
      setAgents(data.agents || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch graph data:', error);
      setLoading(false);
    }
  };

  const fetchAgentStats = async () => {
    try {
      const response = await fetch('/api/agent-graph/statistics');
      const data = await response.json();
      setStats(data.agents || []);
    } catch (error) {
      console.error('Failed to fetch agent stats:', error);
    }
  };

  const fetchKnowledgeStats = async () => {
    try {
      const response = await fetch('/api/agent-graph/knowledge');
      const data = await response.json();
      setKnowledgeStats(data.knowledgeBase || null);
    } catch (error) {
      console.error('Failed to fetch knowledge stats:', error);
    }
  };

  const getAgentColor = (id: string) => {
    const colors: Record<string, string> = {
      wordpress_specialist: 'from-indigo-500 to-purple-500',
      joomla_specialist: 'from-blue-500 to-cyan-500',
      drupal_specialist: 'from-green-500 to-teal-500',
      api_specialist: 'from-cyan-500 to-blue-500',
      generic_scanner: 'from-gray-500 to-slate-500',
    };
    return colors[id] || 'from-purple-500 to-pink-500';
  };

  const getUtilizationColor = (utilization: number) => {
    if (utilization < 0.5) return 'text-green-600 bg-green-50 border-green-200';
    if (utilization < 0.8) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
            Agent Graph
          </h1>
          <p className="text-sm md:text-base text-gray-600 mt-2">
            Multi-agent coordination with distributed parallel execution (4-10x scalability)
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Button variant="outline" className="gap-2">
            <GitBranch className="w-4 h-4" />
            Export Graph
          </Button>
          <Button className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600">
            <Play className="w-4 h-4" />
            Orchestrate Scan
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-cyan-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Total Agents</p>
                <p className="text-3xl font-bold text-cyan-600 mt-1">{agents.length}</p>
              </div>
              <Users className="w-8 h-8 text-cyan-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Total Capacity</p>
                <p className="text-3xl font-bold text-green-600 mt-1">
                  {agents.reduce((sum, a) => sum + a.capacity, 0).toLocaleString()}
                </p>
              </div>
              <Zap className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Discoveries</p>
                <p className="text-3xl font-bold text-purple-600 mt-1">
                  {knowledgeStats?.discoveries?.total || 0}
                </p>
              </div>
              <Brain className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Strategies</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">
                  {knowledgeStats?.strategies?.total || 0}
                </p>
              </div>
              <Target className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="agents" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="agents">Agent Nodes</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
        </TabsList>

        {/* Agent Nodes */}
        <TabsContent value="agents" className="space-y-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600"></div>
              <p className="text-gray-600 mt-4">Loading agents...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agents.map((agent) => (
                <Card
                  key={agent.id}
                  className="hover:shadow-xl transition-all border-2 border-gray-200 hover:border-cyan-300"
                >
                  <CardHeader>
                    <div className={`w-full h-2 rounded-full bg-gradient-to-r ${getAgentColor(agent.id)} mb-4`}></div>
                    <CardTitle className="flex items-center gap-2">
                      <Network className="w-5 h-5" />
                      {agent.id.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </CardTitle>
                    <CardDescription>
                      {agent.specialization.join(', ')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Utilization */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-600">Utilization</span>
                        <Badge className={getUtilizationColor(agent.utilization)}>
                          {(agent.utilization * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full bg-gradient-to-r ${getAgentColor(agent.id)}`}
                          style={{ width: `${agent.utilization * 100}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Load Stats */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-gray-600">Current Load</p>
                        <p className="text-lg font-bold">{agent.currentLoad}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Capacity</p>
                        <p className="text-lg font-bold">{agent.capacity}</p>
                      </div>
                    </div>

                    {/* Specializations */}
                    <div className="pt-3 border-t">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Specializations:</p>
                      <div className="flex flex-wrap gap-1">
                        {agent.specialization.map((spec) => (
                          <Badge key={spec} variant="secondary" className="text-xs">
                            {spec}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Agent Statistics */}
        <TabsContent value="stats" className="space-y-4">
          {stats.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No statistics available</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {stats.map((stat) => (
                <Card key={stat.agentId} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {stat.agentId.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {stat.specialization.join(', ')}
                        </p>
                      </div>
                      <Badge
                        className={
                          stat.successRate > 0.9
                            ? 'bg-green-100 text-green-700'
                            : stat.successRate > 0.7
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }
                      >
                        {(stat.successRate * 100).toFixed(0)}% success
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-600">Total Jobs</p>
                        <p className="text-xl font-bold text-gray-900">{stat.totalJobs}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Completed</p>
                        <p className="text-xl font-bold text-green-600">{stat.completedJobs}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Failed</p>
                        <p className="text-xl font-bold text-red-600">{stat.failedJobs}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Avg Duration</p>
                        <p className="text-xl font-bold text-blue-600">{formatDuration(stat.avgDuration)}</p>
                      </div>
                    </div>

                    {/* Load Meter */}
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-600">Current Load</span>
                        <span className="text-sm font-semibold">
                          {stat.currentLoad} / {stat.capacity}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                          style={{ width: `${(stat.currentLoad / stat.capacity) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Knowledge Base */}
        <TabsContent value="knowledge">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                Shared Knowledge Base
              </CardTitle>
              <CardDescription>
                Agent discoveries and attack strategies shared across the network
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {knowledgeStats ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-purple-700 font-medium">Total Discoveries</p>
                            <p className="text-3xl font-bold text-purple-900 mt-1">
                              {knowledgeStats.discoveries?.total || 0}
                            </p>
                          </div>
                          <Database className="w-8 h-8 text-purple-600" />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-orange-50 to-red-50 border-orange-200">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-orange-700 font-medium">Attack Strategies</p>
                            <p className="text-3xl font-bold text-orange-900 mt-1">
                              {knowledgeStats.strategies?.total || 0}
                            </p>
                            {knowledgeStats.strategies?.avgSuccessRate && (
                              <p className="text-xs text-orange-600 mt-1">
                                {(knowledgeStats.strategies.avgSuccessRate * 100).toFixed(0)}% avg success rate
                              </p>
                            )}
                          </div>
                          <Award className="w-8 h-8 text-orange-600" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Button className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600">
                    <Database className="w-4 h-4" />
                    Browse Knowledge Base
                  </Button>
                </>
              ) : (
                <div className="text-center py-8">
                  <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">Loading knowledge base statistics...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Info Card */}
      <Card className="bg-gradient-to-r from-cyan-50 to-blue-50 border-cyan-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white rounded-lg">
              <Network className="w-6 h-6 text-cyan-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-2">Distributed Multi-Agent Coordination</h3>
              <p className="text-sm text-gray-700 mb-4">
                AgentHunt uses a graph-based multi-agent system with specialized agents for different technologies.
                Work is intelligently distributed based on target classification, with load balancing across agent
                replicas. Agents share discoveries and strategies via a centralized knowledge base.
              </p>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span className="font-semibold">4-10x throughput improvement</span>
                <span className="mx-2">•</span>
                <span>18 agent replicas</span>
                <span className="mx-2">•</span>
                <span>~6,300 concurrent targets</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
