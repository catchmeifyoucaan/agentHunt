'use client';

import { useQuery } from '@tanstack/react-query';
import { jobsApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Clock, CheckCircle, XCircle, Play, Pause } from 'lucide-react';
import Link from 'next/link';

export default function JobStatsPage() {
  const { data: statsData, isLoading } = useQuery({
    queryKey: ['job-stats'],
    queryFn: () => jobsApi.getStats(),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const stats = statsData?.data?.stats;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading job statistics...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 mx-auto mb-2 text-red-500" />
          <p className="text-muted-foreground">Failed to load job statistics</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    active: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  };

  const statusIcons: Record<string, any> = {
    pending: Clock,
    active: Play,
    completed: CheckCircle,
    failed: XCircle,
    cancelled: Pause,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Job Statistics</h1>
          <p className="text-muted-foreground mt-1">
            Overview of all jobs by status and type
          </p>
        </div>
        <Link href="/jobs">
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
            View All Jobs
          </button>
        </Link>
      </div>

      {/* Stuck Jobs Alert */}
      {stats.stuckJobs && stats.stuckJobs.length > 0 && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-900/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertCircle className="w-5 h-5" />
              Stuck Jobs Detected
            </CardTitle>
            <CardDescription>
              {stats.stuckJobs.length} job(s) running for more than 1 hour
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.stuckJobs.slice(0, 5).map((job: any) => (
                <div key={job.id} className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded">
                  <div className="flex items-center gap-2">
                    <Badge>{job.type}</Badge>
                    <span className="text-sm text-muted-foreground">{job.id.slice(0, 8)}...</span>
                  </div>
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    {job.elapsed_hours}h running
                  </span>
                </div>
              ))}
              {stats.stuckJobs.length > 5 && (
                <p className="text-sm text-muted-foreground text-center pt-2">
                  +{stats.stuckJobs.length - 5} more stuck jobs
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs by Status</CardTitle>
          <CardDescription>Total jobs grouped by status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(stats.byStatus || {}).map(([status, count]: [string, any]) => {
              const Icon = statusIcons[status] || Clock;
              return (
                <div
                  key={status}
                  className={`p-4 rounded-lg ${statusColors[status] || statusColors.pending}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium capitalize">{status}</span>
                  </div>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Jobs by Type */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs by Type</CardTitle>
          <CardDescription>Total jobs grouped by agent type</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(stats.byType || {})
              .sort(([, a]: [string, any], [, b]: [string, any]) => b - a)
              .map(([type, count]: [string, any]) => (
                <div
                  key={type}
                  className="p-3 bg-accent rounded-lg border border-border"
                >
                  <p className="text-sm font-medium capitalize mb-1">{type}</p>
                  <p className="text-xl font-bold">{count}</p>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Jobs by Status and Type */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs by Status and Type</CardTitle>
          <CardDescription>Detailed breakdown of jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-accent">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase">Type</th>
                  {Object.keys(stats.byStatus || {}).map((status) => (
                    <th key={status} className="px-4 py-2 text-center text-xs font-medium uppercase capitalize">
                      {status}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.keys(stats.byType || {})
                  .sort()
                  .map((type) => (
                    <tr key={type} className="hover:bg-accent/50">
                      <td className="px-4 py-2 font-medium capitalize">{type}</td>
                      {Object.keys(stats.byStatus || {}).map((status) => (
                        <td key={status} className="px-4 py-2 text-center">
                          {stats.byStatusAndType[status]?.[type] || 0}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      {stats.recentActivity && stats.recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity (Last 24 Hours)</CardTitle>
            <CardDescription>Job creation activity by hour</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {stats.recentActivity.slice(0, 20).map((activity: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-accent rounded"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {new Date(activity.hour).toLocaleString()}
                    </span>
                    <Badge className="capitalize">{activity.type}</Badge>
                    <span className={`text-xs px-2 py-1 rounded capitalize ${statusColors[activity.status] || ''}`}>
                      {activity.status}
                    </span>
                  </div>
                  <span className="text-sm font-medium">{activity.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
