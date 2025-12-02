'use client';

import { useQuery } from '@tanstack/react-query';
import { programsApi, jobsApi } from '@/lib/api';
import { Activity, AlertTriangle, FolderOpen, Target, TrendingUp } from 'lucide-react';
import { useEventStream } from '@/hooks/useWebSocket';
import { formatRelativeTime, getSeverityColor } from '@/lib/utils';
import Link from 'next/link';

export default function Dashboard() {
  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => jobsApi.list({ limit: 10 }),
  });

  const { data: queueStats } = useQuery({
    queryKey: ['queue-stats'],
    queryFn: () => jobsApi.getQueueStats(),
    refetchInterval: 5000,
  });

  const { events } = useEventStream();

  const programs = programsData?.data?.programs || [];
  const jobs = jobsData?.data?.jobs || [];
  const recentFindings = events.filter((e) => e.type === 'finding').slice(-10);

  // Calculate stats
  const activeJobs = jobs.filter((j: any) => j.status === 'active').length;
  const totalAssets = programs.reduce((sum: number, p: any) => sum + (p.asset_count || 0), 0);
  const totalFindings = programs.reduce((sum: number, p: any) => sum + (p.finding_count || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome to AgentHunt - AI Security Orchestration Platform
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Active Programs"
          value={programs.length}
          icon={FolderOpen}
          trend="+2 this week"
        />
        <StatCard
          title="Total Assets"
          value={totalAssets.toLocaleString()}
          icon={Target}
          trend="+1.2k today"
        />
        <StatCard
          title="Active Jobs"
          value={activeJobs}
          icon={Activity}
          trend="3 queued"
        />
        <StatCard
          title="Total Findings"
          value={totalFindings}
          icon={AlertTriangle}
          trend="+5 today"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Jobs */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Jobs</h2>
          <div className="space-y-3">
            {jobs.slice(0, 5).map((job: any) => (
              <div key={job.id} className="flex items-center justify-between p-3 bg-accent/50 rounded-md">
                <div className="flex-1">
                  <p className="text-sm font-medium">{job.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(job.created_at)}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${getStatusColor(job.status)}`}>
                  {job.status}
                </span>
              </div>
            ))}
            {jobs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No jobs yet. Create your first program to get started!
              </p>
            )}
          </div>
          <Link
            href="/jobs"
            className="text-sm text-primary hover:underline mt-4 inline-block"
          >
            View all jobs →
          </Link>
        </div>

        {/* Recent Findings */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Findings</h2>
          <div className="space-y-3">
            {recentFindings.map((event: any) => {
              const finding = event.finding;
              return (
                <div key={event.id} className="flex items-start justify-between p-3 bg-accent/50 rounded-md">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{finding.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Confidence: {Math.round(finding.confidence * 100)}%
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${getSeverityColor(finding.severity)}`}>
                    {finding.severity}
                  </span>
                </div>
              );
            })}
            {recentFindings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No findings yet. Run scans to discover vulnerabilities!
              </p>
            )}
          </div>
          <Link
            href="/findings"
            className="text-sm text-primary hover:underline mt-4 inline-block"
          >
            View all findings →
          </Link>
        </div>
      </div>

      {/* Queue Status */}
      {queueStats && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Queue Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Object.entries(queueStats.data.queues || {}).map(([name, stats]: [string, any]) => (
              <div key={name} className="p-4 bg-accent/50 rounded-md">
                <p className="text-xs text-muted-foreground uppercase">{name}</p>
                <p className="text-2xl font-bold mt-1">{stats.waiting || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.active || 0} active
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, trend }: any) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-3xl font-bold mt-2">{value}</p>
      <div className="flex items-center gap-1 mt-2">
        <TrendingUp className="w-3 h-3 text-green-500" />
        <p className="text-xs text-muted-foreground">{trend}</p>
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    case 'active':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  }
}
