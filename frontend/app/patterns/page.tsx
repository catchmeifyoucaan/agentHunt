'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Play,
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Zap,
  Target,
  GitBranch,
  Plus,
  History,
  Star,
  Search,
  Filter,
  ArrowRight,
} from 'lucide-react';

interface Pattern {
  name: string;
  description: string;
  tags: string[];
  estimatedDuration: string;
  estimatedCost: string;
  steps: PatternStep[];
  metadata?: {
    useCase?: string;
    targetAudience?: string;
    requirements?: string[];
  };
}

interface PatternStep {
  agent: string;
  options: Record<string, any>;
  priority?: number;
}

interface PatternExecution {
  id: string;
  patternName: string;
  programId: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  stepsExecuted: number;
  stepsTotal: number;
}

export default function PatternsPage() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [executions, setExecutions] = useState<PatternExecution[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [selectedProgram, setSelectedProgram] = useState('');
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    fetchPatterns();
    fetchExecutions();
  }, []);

  const fetchPatterns = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/api/v1/patterns`);
      if (!response.ok) throw new Error('Failed to fetch patterns');
      const data = await response.json();
      setPatterns(data.patterns || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch patterns:', error);
      setPatterns([]);
      setLoading(false);
    }
  };

  const fetchExecutions = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/api/v1/patterns/executions/history?limit=50`);
      if (!response.ok) throw new Error('Failed to fetch executions');
      const data = await response.json();
      setExecutions(data.executions || []);
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      setExecutions([]);
    }
  };

  const executePattern = async (patternName: string) => {
    if (!selectedProgram) {
      alert('Please select a program first');
      return;
    }

    try {
      setExecuting(true);
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/api/v1/patterns/${patternName}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programId: selectedProgram }),
      });

      if (!response.ok) throw new Error('Failed to execute pattern');

      const data = await response.json();
      alert(`Pattern "${patternName}" started successfully!\nExecution ID: ${data.result.executionId}`);
      fetchExecutions();
    } catch (error: any) {
      alert(`Failed to execute pattern: ${error.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const getTagColor = (tag: string) => {
    const colors: Record<string, string> = {
      reconnaissance: 'bg-blue-100 text-blue-700 border-blue-200',
      comprehensive: 'bg-purple-100 text-purple-700 border-purple-200',
      fast: 'bg-green-100 text-green-700 border-green-200',
      quick: 'bg-green-100 text-green-700 border-green-200',
      slow: 'bg-orange-100 text-orange-700 border-orange-200',
      wordpress: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      api: 'bg-cyan-100 text-cyan-700 border-cyan-200',
      targeted: 'bg-pink-100 text-pink-700 border-pink-200',
      specialized: 'bg-violet-100 text-violet-700 border-violet-200',
    };
    return colors[tag] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const getStatusColor = (status: string) => {
    const colors = {
      in_progress: 'bg-blue-100 text-blue-700 border-blue-300',
      completed: 'bg-green-100 text-green-700 border-green-300',
      failed: 'bg-red-100 text-red-700 border-red-300',
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-700';
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Workflow Patterns
          </h1>
          <p className="text-sm md:text-base text-gray-600 mt-2">
            Pre-built and custom workflow templates for different scan types
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Button variant="outline" className="gap-2">
            <History className="w-4 h-4" />
            View History
          </Button>
          <Button className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
            <Plus className="w-4 h-4" />
            Create Pattern
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Total Patterns</p>
                <p className="text-3xl font-bold text-purple-600 mt-1">{patterns.length}</p>
              </div>
              <GitBranch className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Executions (24h)</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{executions.length}</p>
              </div>
              <Play className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Success Rate</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">
                  {((executions.filter((e) => e.status === 'completed').length / executions.length) * 100 || 0).toFixed(0)}%
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 hover:shadow-lg transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Avg Duration</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">
                  {formatDuration(
                    executions.reduce((sum, e) => sum + (e.duration || 0), 0) / executions.length || 0
                  )}
                </p>
              </div>
              <Clock className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="available" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="available">Available Patterns</TabsTrigger>
          <TabsTrigger value="executions">Executions</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>

        {/* Available Patterns */}
        <TabsContent value="available" className="space-y-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <p className="text-gray-600 mt-4">Loading patterns...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {patterns.map((pattern) => (
                <Card
                  key={pattern.name}
                  className={`hover:shadow-xl transition-all cursor-pointer border-2 ${
                    selectedPattern?.name === pattern.name
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                  onClick={() => setSelectedPattern(pattern)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-xl flex items-center gap-2">
                          {pattern.name}
                          {pattern.tags.includes('fast') && <Zap className="w-5 h-5 text-yellow-500" />}
                        </CardTitle>
                        <CardDescription className="mt-2 line-clamp-2">
                          {pattern.description}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {pattern.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className={`${getTagColor(tag)} text-xs`}>
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Metadata */}
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <Clock className="w-4 h-4" />
                          <span>{pattern.estimatedDuration}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <DollarSign className="w-4 h-4" />
                          <span>{pattern.estimatedCost}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <GitBranch className="w-4 h-4" />
                          <span>{pattern.steps.length} steps</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Target className="w-4 h-4" />
                          <span>Multi-agent</span>
                        </div>
                      </div>

                      {/* Workflow Steps */}
                      <div className="pt-3 border-t">
                        <p className="text-xs font-semibold text-gray-700 mb-2">Workflow Steps:</p>
                        <div className="flex items-center gap-1 flex-wrap">
                          {pattern.steps.map((step, idx) => (
                            <div key={idx} className="flex items-center gap-1">
                              <Badge variant="secondary" className="text-xs">
                                {step.agent}
                              </Badge>
                              {idx < pattern.steps.length - 1 && (
                                <ArrowRight className="w-3 h-3 text-gray-400" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Use Case */}
                      {pattern.metadata?.useCase && (
                        <div className="pt-3 border-t">
                          <p className="text-xs font-semibold text-gray-700 mb-1">Use Case:</p>
                          <p className="text-xs text-gray-600">{pattern.metadata.useCase}</p>
                        </div>
                      )}

                      {/* Execute Button */}
                      <Button
                        onClick={() => executePattern(pattern.name)}
                        disabled={executing}
                        className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                      >
                        <Play className="w-4 h-4" />
                        Execute Pattern
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Executions History */}
        <TabsContent value="executions" className="space-y-4">
          {executions.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <History className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No pattern executions yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {executions.map((execution) => (
                <Card key={execution.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-gray-900">{execution.patternName}</h3>
                          <Badge className={getStatusColor(execution.status)}>
                            {execution.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <span>ID: {execution.id.slice(0, 8)}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {execution.duration ? formatDuration(execution.duration) : 'In progress'}
                          </span>
                          <span>
                            {execution.stepsExecuted} / {execution.stepsTotal} steps
                          </span>
                          <span>{new Date(execution.startedAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Recommendations */}
        <TabsContent value="recommendations">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500" />
                Smart Recommendations
              </CardTitle>
              <CardDescription>
                AI-powered pattern recommendations based on your program characteristics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">Select a program to see recommended patterns</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
