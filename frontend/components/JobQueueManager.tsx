'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jobsApi } from '@/lib/api';
import { Play, Pause, Trash2, RotateCcw, Clock, CheckCircle, XCircle } from 'lucide-react';

export function JobQueueManager() {
  const queryClient = useQueryClient();
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);

  const { data: jobsData } = useQuery({
    queryKey: ['jobs-queue'],
    queryFn: () => jobsApi.list({ limit: 100 }),
    refetchInterval: 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-queue'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => jobsApi.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs-queue'] });
    },
  });

  const jobs = jobsData?.data?.jobs || [];
  const pendingJobs = jobs.filter((j: any) => j.status === 'pending');
  const activeJobs = jobs.filter((j: any) => j.status === 'active');
  const completedJobs = jobs.filter((j: any) => j.status === 'completed');
  const failedJobs = jobs.filter((j: any) => j.status === 'failed');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'active':
        return <Play className="w-4 h-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-yellow-100 dark:bg-yellow-900/20 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
            {pendingJobs.length}
          </p>
        </div>
        <div className="bg-blue-100 dark:bg-blue-900/20 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Play className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium">Active</span>
          </div>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
            {activeJobs.length}
          </p>
        </div>
        <div className="bg-green-100 dark:bg-green-900/20 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium">Completed</span>
          </div>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300">
            {completedJobs.length}
          </p>
        </div>
        <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-sm font-medium">Failed</span>
          </div>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300">
            {failedJobs.length}
          </p>
        </div>
      </div>

      {/* Job List */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-accent">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase">Program</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase">Created</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.slice(0, 20).map((job: any) => (
                <tr key={job.id} className="hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="text-sm capitalize">{job.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium">{job.type}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {job.program_id ? job.program_id.slice(0, 8) : 'N/A'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${
                      job.priority >= 8 ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
                      job.priority >= 5 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                      'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300'
                    }`}>
                      {job.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(job.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {job.status === 'failed' && (
                        <button
                          onClick={() => retryMutation.mutate(job.id)}
                          className="p-1 hover:bg-accent rounded"
                          title="Retry"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      {(job.status === 'pending' || job.status === 'active') && (
                        <button
                          onClick={() => cancelMutation.mutate(job.id)}
                          className="p-1 hover:bg-accent rounded text-red-500"
                          title="Cancel"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No jobs in queue
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
