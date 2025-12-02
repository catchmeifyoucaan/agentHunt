'use client';

import React from 'react';
import { AgentType } from '@/shared/types';
import { getAgentMetadata } from '@/lib/agentMetadata';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Activity, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface AgentStats {
  total: number;
  active: number;
  completed: number;
  failed: number;
  queued: number;
  avgDuration?: number;
}

interface AgentCardProps {
  agentType: AgentType;
  stats?: AgentStats;
  onCreateJob?: () => void;
  compact?: boolean;
}

export function AgentCard({ agentType, stats, onCreateJob, compact = false }: AgentCardProps) {
  const metadata = getAgentMetadata(agentType);

  if (!metadata) {
    return null; // Agent doesn't have metadata defined yet
  }

  const Icon = metadata.icon;

  const getCategoryColor = (category: string) => {
    const colors = {
      reconnaissance: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      scanning: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
      exploitation: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
      analysis: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
      ai: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
    };
    return colors[category as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getIconColor = (bgColor: string) => {
    const colorMap: Record<string, string> = {
      'bg-blue-600': 'text-blue-600',
      'bg-green-600': 'text-green-600',
      'bg-purple-600': 'text-purple-600',
      'bg-orange-600': 'text-orange-600',
      'bg-red-600': 'text-red-600',
      'bg-yellow-600': 'text-yellow-600',
      'bg-cyan-600': 'text-cyan-600',
      'bg-pink-600': 'text-pink-600',
      'bg-indigo-600': 'text-indigo-600',
      'bg-teal-600': 'text-teal-600',
    };
    return colorMap[bgColor] || 'text-gray-600';
  };

  if (compact) {
    return (
      <Card className="hover:shadow-lg transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${metadata.color} bg-opacity-10`}>
                <Icon className={`w-5 h-5 ${getIconColor(metadata.color)}`} />
              </div>
              <div>
                <h3 className="font-semibold text-sm">{metadata.name}</h3>
                {stats && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      {stats.active}
                    </span>
                    <span className="text-xs text-gray-500">•</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {stats.total} total
                    </span>
                  </div>
                )}
              </div>
            </div>
            {onCreateJob && (
              <Button size="sm" variant="ghost" onClick={onCreateJob}>
                <Play className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-xl transition-all hover:scale-105 duration-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-lg ${metadata.color} bg-opacity-10`}>
            <Icon className={`w-8 h-8 ${getIconColor(metadata.color)}`} />
          </div>
          <Badge className={getCategoryColor(metadata.category)}>
            {metadata.category}
          </Badge>
        </div>
        <CardTitle className="mt-4">{metadata.name}</CardTitle>
        <CardDescription className="text-sm line-clamp-2">
          {metadata.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
                <Activity className="w-3 h-3" />
                Active
              </div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stats.active}
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
                <Clock className="w-3 h-3" />
                Queued
              </div>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {stats.queued}
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
                <CheckCircle2 className="w-3 h-3" />
                Completed
              </div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {stats.completed}
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
                <XCircle className="w-3 h-3" />
                Failed
              </div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {stats.failed}
              </div>
            </div>
          </div>
        )}

        {/* Additional Info */}
        {stats && stats.avgDuration && (
          <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-200 dark:border-gray-700">
            <span className="text-gray-600 dark:text-gray-400">Avg. Duration</span>
            <span className="font-medium">{formatDuration(stats.avgDuration)}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {onCreateJob && (
            <Button onClick={onCreateJob} className="flex-1" size="sm">
              <Play className="w-4 h-4 mr-2" />
              Create Job
            </Button>
          )}
          <Link href={`/jobs?type=${agentType}`} className="flex-1">
            <Button variant="outline" className="w-full" size="sm">
              View Jobs
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

interface AgentGridProps {
  agents: AgentType[];
  statsMap?: Partial<Record<AgentType, AgentStats>>;
  onCreateJob?: (agentType: AgentType) => void;
  compact?: boolean;
  category?: string;
}

export function AgentGrid({ agents, statsMap = {}, onCreateJob, compact = false, category }: AgentGridProps) {
  const filteredAgents = category
    ? agents.filter(type => {
        const meta = getAgentMetadata(type);
        return meta && meta.category === category;
      })
    : agents;

  return (
    <div className={`grid gap-4 ${compact ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
      {filteredAgents.map((agentType) => (
        <AgentCard
          key={agentType}
          agentType={agentType}
          stats={statsMap[agentType]}
          onCreateJob={onCreateJob ? () => onCreateJob(agentType) : undefined}
          compact={compact}
        />
      ))}
    </div>
  );
}
