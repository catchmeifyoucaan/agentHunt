'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Brain,
  Database,
  Target,
  Shield,
  Zap,
  TrendingUp,
  Clock,
  Users,
  Search,
  Filter,
  BarChart3,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Globe,
  Server,
  Lock,
  Lightbulb,
  Trophy,
  Activity,
} from 'lucide-react';
import { knowledgeApi } from '@/lib/api';

/**
 * Knowledge Base Browser - Phase 4: Graph of Agents
 *
 * Displays agent discoveries, attack strategies, and target metadata
 * from the shared knowledge base that enables multi-agent coordination.
 */

// Types from backend
interface Discovery {
  id: string;
  target: string;
  type: string;
  details: Record<string, any>;
  discoveredBy: string;
  timestamp: string;
  confidence: number;
  metadata?: Record<string, any>;
}

interface Strategy {
  id: string;
  type: string;
  technique: string;
  payload: string;
  successCount: number;
  attemptCount: number;
  successRate: number;
  sharedBy: string;
  timestamp: string;
  targetPattern?: string;
  metadata?: Record<string, any>;
}

interface TargetMetadata {
  target: string;
  technologies?: string[];
  waf?: string;
  cdn?: string;
  httpStatus?: number;
  responseTime?: number;
  lastChecked?: string;
  customData?: Record<string, any>;
}

interface KnowledgeBaseStats {
  discoveries: {
    total: number;
    byType: Record<string, number>;
  };
  strategies: {
    total: number;
    byType: Record<string, number>;
    avgSuccessRate: number;
  };
  metadata: {
    total: number;
  };
  agentContributions: Record<string, number>;
}

export default function KnowledgeBasePage() {
  const [stats, setStats] = useState<KnowledgeBaseStats | null>(null);
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [targetMetadata, setTargetMetadata] = useState<TargetMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [selectedTab, setSelectedTab] = useState('discoveries');

  // Fetch knowledge base data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch stats from backend
        const statsResponse = await knowledgeApi.getStats();
        setStats(statsResponse.data);

        // Fetch discoveries
        const discoveriesResponse = await knowledgeApi.getDiscoveries({ limit: 100 });
        setDiscoveries(discoveriesResponse.data.discoveries || []);

        // Fetch strategies
        const strategiesResponse = await knowledgeApi.getStrategies({ limit: 100 });
        setStrategies(strategiesResponse.data.strategies || []);

        // Fetch target metadata
        const metadataResponse = await knowledgeApi.getMetadata({ limit: 100 });
        setTargetMetadata(metadataResponse.data.metadata || []);
      } catch (error) {
        console.error('Failed to fetch knowledge base data:', error);
        // Set empty states on error
        setStats(null);
        setDiscoveries([]);
        setStrategies([]);
        setTargetMetadata([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Filter discoveries
  const filteredDiscoveries = discoveries.filter((d) => {
    const matchesSearch =
      searchQuery === '' ||
      d.target.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || d.type === filterType;
    const matchesAgent = filterAgent === 'all' || d.discoveredBy === filterAgent;
    return matchesSearch && matchesType && matchesAgent;
  });

  // Filter strategies
  const filteredStrategies = strategies.filter((s) => {
    const matchesSearch =
      searchQuery === '' ||
      s.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.technique.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || s.type === filterType;
    const matchesAgent = filterAgent === 'all' || s.sharedBy === filterAgent;
    return matchesSearch && matchesType && matchesAgent;
  });

  // Get unique types for filtering
  const discoveryTypes = Array.from(new Set(discoveries.map((d) => d.type)));
  const strategyTypes = Array.from(new Set(strategies.map((s) => s.type)));
  const agents = Array.from(
    new Set([...discoveries.map((d) => d.discoveredBy), ...strategies.map((s) => s.sharedBy)])
  );

  // Helper functions
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return `${Math.floor(diff / (1000 * 60))}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const getDiscoveryTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      wordpress_vuln: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      api_endpoint: 'bg-cyan-100 text-cyan-700 border-cyan-200',
      technology: 'bg-blue-100 text-blue-700 border-blue-200',
      high_value_target: 'bg-red-100 text-red-700 border-red-200',
      sqli_vuln: 'bg-purple-100 text-purple-700 border-purple-200',
      xss_vuln: 'bg-orange-100 text-orange-700 border-orange-200',
      rce_vuln: 'bg-pink-100 text-pink-700 border-pink-200',
    };
    return colors[type] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const getStrategyTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      sqli: 'bg-purple-100 text-purple-700 border-purple-200',
      xss: 'bg-orange-100 text-orange-700 border-orange-200',
      rce: 'bg-red-100 text-red-700 border-red-200',
      auth_bypass: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      file_upload: 'bg-green-100 text-green-700 border-green-200',
      path_traversal: 'bg-blue-100 text-blue-700 border-blue-200',
    };
    return colors[type] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.9)
      return <Badge className="bg-green-100 text-green-700 border-green-200">High</Badge>;
    if (confidence >= 0.7)
      return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Medium</Badge>;
    return <Badge className="bg-orange-100 text-orange-700 border-orange-200">Low</Badge>;
  };

  const getSuccessRateBadge = (rate: number) => {
    if (rate >= 0.7)
      return <Badge className="bg-green-100 text-green-700 border-green-200">{(rate * 100).toFixed(0)}%</Badge>;
    if (rate >= 0.4)
      return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">{(rate * 100).toFixed(0)}%</Badge>;
    return <Badge className="bg-orange-100 text-orange-700 border-orange-200">{(rate * 100).toFixed(0)}%</Badge>;
  };

  const getAgentIcon = (agentId: string) => {
    if (agentId.includes('wordpress')) return '🔷';
    if (agentId.includes('api')) return '🔶';
    if (agentId.includes('joomla')) return '🔵';
    if (agentId.includes('drupal')) return '🟢';
    return '⚫';
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="animate-pulse space-y-8">
          <div className="h-12 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
          Knowledge Base
        </h1>
        <p className="text-sm md:text-base text-gray-600">
          Shared discoveries, attack strategies, and target intelligence across all agents
        </p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Total Discoveries
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">
                {stats.discoveries.total.toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">Shared across all agents</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-pink-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                Attack Strategies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-pink-600">
                {stats.strategies.total.toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Avg success: {(stats.strategies.avgSuccessRate * 100).toFixed(0)}%
              </p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-cyan-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Target className="w-4 h-4" />
                Target Metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-600">
                {stats.metadata.total.toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 mt-1">Cached target intelligence</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Active Agents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {Object.keys(stats.agentContributions || {}).length}
              </div>
              <p className="text-xs text-gray-500 mt-1">Contributing to knowledge base</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Agent Contributions Chart */}
      {stats && (
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Agent Contributions
            </CardTitle>
            <CardDescription>Discoveries shared by each specialized agent</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(stats.agentContributions || {})
                .sort(([, a], [, b]) => b - a)
                .map(([agentId, count]) => (
                  <div key={agentId}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getAgentIcon(agentId)}</span>
                        <span className="text-sm font-medium">
                          {agentId.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                      </div>
                      <Badge variant="outline">{count} discoveries</Badge>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500"
                        style={{
                          width: `${(count / Math.max(...Object.values(stats.agentContributions || {}), 1)) * 100}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Search discoveries, strategies, targets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="all">All Types</option>
                {selectedTab === 'discoveries'
                  ? discoveryTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ')}
                      </option>
                    ))
                  : strategyTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ')}
                      </option>
                    ))}
              </select>
              <select
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="all">All Agents</option>
                {agents.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="discoveries">
            <Database className="w-4 h-4 mr-2" />
            Discoveries ({filteredDiscoveries.length})
          </TabsTrigger>
          <TabsTrigger value="strategies">
            <Lightbulb className="w-4 h-4 mr-2" />
            Strategies ({filteredStrategies.length})
          </TabsTrigger>
          <TabsTrigger value="metadata">
            <Globe className="w-4 h-4 mr-2" />
            Target Metadata ({targetMetadata.length})
          </TabsTrigger>
        </TabsList>

        {/* Discoveries Tab */}
        <TabsContent value="discoveries" className="space-y-4">
          {filteredDiscoveries.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                No discoveries found matching your filters
              </CardContent>
            </Card>
          ) : (
            filteredDiscoveries.map((discovery) => (
              <Card
                key={discovery.id}
                className="hover:shadow-xl transition-all border-2 border-gray-200 hover:border-purple-300"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={getDiscoveryTypeColor(discovery.type)}>
                          {discovery.type.replace(/_/g, ' ')}
                        </Badge>
                        {getConfidenceBadge(discovery.confidence)}
                      </div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Target className="w-5 h-5 text-purple-600" />
                        {discovery.target}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {discovery.details.description || discovery.details.vulnerability || 'No description'}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* Discovery Details */}
                    <div className="bg-gray-50 p-3 rounded-md">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        {Object.entries(discovery.details).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-gray-600 font-medium">{key}:</span>{' '}
                            <span className="text-gray-900">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <span className="text-lg">{getAgentIcon(discovery.discoveredBy)}</span>
                          {discovery.discoveredBy.replace(/_/g, ' ')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {formatTimestamp(discovery.timestamp)}
                        </span>
                      </div>
                      <Badge variant="outline">
                        Confidence: {(discovery.confidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Strategies Tab */}
        <TabsContent value="strategies" className="space-y-4">
          {filteredStrategies.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                No strategies found matching your filters
              </CardContent>
            </Card>
          ) : (
            filteredStrategies.map((strategy) => (
              <Card
                key={strategy.id}
                className="hover:shadow-xl transition-all border-2 border-gray-200 hover:border-pink-300"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={getStrategyTypeColor(strategy.type)}>
                          {strategy.type.toUpperCase()}
                        </Badge>
                        {getSuccessRateBadge(strategy.successRate)}
                        {strategy.successRate >= 0.7 && (
                          <Trophy className="w-4 h-4 text-yellow-500" />
                        )}
                      </div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Zap className="w-5 h-5 text-pink-600" />
                        {strategy.technique.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </CardTitle>
                      {strategy.targetPattern && (
                        <CardDescription className="mt-2">
                          Target Pattern: {strategy.targetPattern}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* Payload */}
                    <div className="bg-gray-900 text-green-400 p-3 rounded-md font-mono text-sm overflow-x-auto">
                      {strategy.payload}
                    </div>

                    {/* Statistics */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-3 bg-green-50 rounded-md">
                        <div className="text-2xl font-bold text-green-600">{strategy.successCount}</div>
                        <div className="text-xs text-gray-600">Successes</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-md">
                        <div className="text-2xl font-bold text-gray-600">{strategy.attemptCount}</div>
                        <div className="text-xs text-gray-600">Attempts</div>
                      </div>
                      <div className="text-center p-3 bg-blue-50 rounded-md">
                        <div className="text-2xl font-bold text-blue-600">
                          {(strategy.successRate * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-gray-600">Success Rate</div>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <span className="text-lg">{getAgentIcon(strategy.sharedBy)}</span>
                          {strategy.sharedBy.replace(/_/g, ' ')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {formatTimestamp(strategy.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Metadata Tab */}
        <TabsContent value="metadata" className="space-y-4">
          {targetMetadata.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                No target metadata available
              </CardContent>
            </Card>
          ) : (
            targetMetadata.map((meta, idx) => (
              <Card
                key={idx}
                className="hover:shadow-xl transition-all border-2 border-gray-200 hover:border-cyan-300"
              >
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Globe className="w-5 h-5 text-cyan-600" />
                    {meta.target}
                  </CardTitle>
                  {meta.lastChecked && (
                    <CardDescription>
                      Last checked: {formatTimestamp(meta.lastChecked)}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Technologies */}
                    {meta.technologies && meta.technologies.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                          <Server className="w-4 h-4" />
                          Technologies
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {meta.technologies.map((tech) => (
                            <Badge key={tech} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {tech}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Security */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {meta.waf && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            WAF
                          </h4>
                          <Badge className="bg-orange-100 text-orange-700 border-orange-200">{meta.waf}</Badge>
                        </div>
                      )}
                      {meta.cdn && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            CDN
                          </h4>
                          <Badge className="bg-green-100 text-green-700 border-green-200">{meta.cdn}</Badge>
                        </div>
                      )}
                    </div>

                    {/* Performance */}
                    {(meta.httpStatus || meta.responseTime) && (
                      <div className="grid grid-cols-2 gap-4">
                        {meta.httpStatus && (
                          <div className="text-center p-3 bg-gray-50 rounded-md">
                            <div className="text-2xl font-bold text-gray-600">{meta.httpStatus}</div>
                            <div className="text-xs text-gray-600">HTTP Status</div>
                          </div>
                        )}
                        {meta.responseTime && (
                          <div className="text-center p-3 bg-blue-50 rounded-md">
                            <div className="text-2xl font-bold text-blue-600">{meta.responseTime}ms</div>
                            <div className="text-xs text-gray-600">Response Time</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
