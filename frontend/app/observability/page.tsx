'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PHOENIX_URL } from '@/lib/api';
import {
  Activity,
  ExternalLink,
  Zap,
  BarChart3,
  Eye,
} from 'lucide-react';

export default function ObservabilityPage() {
  const openPhoenix = () => {
    window.open(PHOENIX_URL, '_blank', 'noopener,noreferrer');
  };

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
            Monitor agent performance, trace executions, and analyze system behavior with Phoenix
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Button onClick={openPhoenix} size="lg" className="bg-purple-600 hover:bg-purple-700">
            <ExternalLink className="w-5 h-5 mr-2" />
            Open Phoenix UI
          </Button>
        </div>
      </div>

      {/* Phoenix Integration Card */}
      <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Eye className="w-6 h-6 text-purple-600" />
            Phoenix Observability Platform
          </CardTitle>
          <CardDescription className="text-base">
            AgentHunt is integrated with Arize Phoenix for comprehensive observability and tracing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white rounded-lg border border-purple-100">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-yellow-600" />
                <h3 className="font-semibold text-gray-900">Real-time Traces</h3>
              </div>
              <p className="text-sm text-gray-600">
                Monitor agent executions, tool calls, and AI interactions in real-time
              </p>
            </div>
            <div className="p-4 bg-white rounded-lg border border-purple-100">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Performance Metrics</h3>
              </div>
              <p className="text-sm text-gray-600">
                Analyze duration, latency, error rates, and resource utilization
              </p>
            </div>
            <div className="p-4 bg-white rounded-lg border border-purple-100">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-gray-900">Cost Tracking</h3>
              </div>
              <p className="text-sm text-gray-600">
                Track token usage and LLM costs across all AI provider interactions
              </p>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-3">Available in Phoenix UI:</h4>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-purple-600 mt-0.5">•</span>
                <span><strong>Distributed Tracing:</strong> View complete execution paths across agents, tools, and AI calls</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 mt-0.5">•</span>
                <span><strong>Span Analysis:</strong> Drill down into individual operations and measure performance</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 mt-0.5">•</span>
                <span><strong>Error Tracking:</strong> Identify failures, exceptions, and bottlenecks</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 mt-0.5">•</span>
                <span><strong>LLM Observability:</strong> Monitor prompts, responses, token usage, and model performance</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 mt-0.5">•</span>
                <span><strong>Time Range Filtering:</strong> Analyze historical data and identify trends</span>
              </li>
            </ul>
          </div>

          <div className="flex justify-center pt-4">
            <Button onClick={openPhoenix} size="lg" className="bg-purple-600 hover:bg-purple-700">
              <ExternalLink className="w-5 h-5 mr-2" />
              Launch Phoenix Observability Platform
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>What is OpenTelemetry?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-700">
            <p>
              AgentHunt uses OpenTelemetry to instrument all agent executions, tool calls, and AI interactions.
              This provides complete visibility into system behavior and performance.
            </p>
            <p>
              Every job execution is traced from start to finish, capturing:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Agent lifecycle events (start, progress, completion)</li>
              <li>Tool execution duration and results</li>
              <li>AI model calls with token usage and costs</li>
              <li>Database queries and external API calls</li>
              <li>Error stack traces and debugging context</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to Use Phoenix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-700">
            <p>
              Phoenix provides a powerful web interface for exploring traces and analyzing performance:
            </p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Click "Open Phoenix UI" to launch the platform</li>
              <li>Select a time range to analyze (last hour, day, week)</li>
              <li>Browse traces by agent type, status, or duration</li>
              <li>Click any trace to view its complete span tree</li>
              <li>Analyze LLM costs and token usage over time</li>
              <li>Identify slow operations and optimize performance</li>
            </ol>
            <p className="text-purple-600 font-medium mt-4">
              Phoenix URL: <code className="bg-purple-50 px-2 py-1 rounded text-xs">{PHOENIX_URL}</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
