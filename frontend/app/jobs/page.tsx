'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jobsApi, programsApi } from '@/lib/api';
import { Play, Pause, Trash2, RotateCcw, Clock, CheckCircle, XCircle, Filter, Search } from 'lucide-react';

export default function JobsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: jobsData, isLoading } = useQuery({
    queryKey: ['all-jobs'],
    queryFn: () => jobsApi.list({ limit: 500 }),
    refetchInterval: 5000,
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-jobs'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => jobsApi.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-jobs'] });
    },
  });

  const jobs = jobsData?.data?.jobs || [];
  const programs = programsData?.data?.programs || [];

  // Get program name by ID
  const getProgramName = (programId: string) => {
    const program = programs.find((p: any) => p.id === programId);
    return program ? program.name : programId?.slice(0, 8) || 'N/A';
  };

  // Filter jobs
  const filteredJobs = jobs.filter((job: any) => {
    const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
    const matchesType = typeFilter === 'all' || job.type === typeFilter;
    const matchesSearch = !searchTerm ||
      job.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getProgramName(job.program_id).toLowerCase().includes(searchTerm.toLowerCase());

    return matchesStatus && matchesType && matchesSearch;
  });

  // Get unique job types
  const jobTypes = Array.from(new Set(jobs.map((j: any) => j.type))) as string[];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'active':
        return <Play className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-gray-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'active':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Jobs</h1>
        <p className="text-muted-foreground mt-1">
          View and manage all security scanning jobs
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatBox
          label="Total"
          value={jobs.length}
          color="gray"
        />
        <StatBox
          label="Pending"
          value={jobs.filter((j: any) => j.status === 'pending').length}
          color="yellow"
        />
        <StatBox
          label="Active"
          value={jobs.filter((j: any) => j.status === 'active').length}
          color="blue"
        />
        <StatBox
          label="Completed"
          value={jobs.filter((j: any) => j.status === 'completed').length}
          color="green"
        />
        <StatBox
          label="Failed"
          value={jobs.filter((j: any) => j.status === 'failed').length}
          color="red"
        />
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
              <Search className="w-4 h-4" />
              Search
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by type, ID, or program..."
              className="w-full px-3 py-2 bg-background border border-border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md"
            >
              <option value="all">All Types</option>
              {jobTypes.map((type: string) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No jobs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-accent">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase">Program</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase">Updated</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredJobs.map((job: any) => (
                  <tr key={job.id} className="hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(job.status)}
                        <span className={`text-xs px-2 py-1 rounded capitalize ${getStatusColor(job.status)}`}>
                          {job.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">{job.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        {getProgramName(job.program_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        job.priority >= 8 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                        job.priority >= 5 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
                      }`}>
                        {job.priority || 5}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(job.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {job.status === 'failed' && (
                          <button
                            onClick={() => retryMutation.mutate(job.id)}
                            className="p-2 hover:bg-accent rounded-md transition-colors"
                            title="Retry Job"
                          >
                            <RotateCcw className="w-4 h-4 text-blue-500" />
                          </button>
                        )}
                        {(job.status === 'pending' || job.status === 'active') && (
                          <button
                            onClick={() => cancelMutation.mutate(job.id)}
                            className="p-2 hover:bg-accent rounded-md transition-colors"
                            title="Cancel Job"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Showing count */}
      <div className="text-sm text-muted-foreground text-center">
        Showing {filteredJobs.length} of {jobs.length} jobs
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-100 dark:bg-gray-900/30 text-gray-800 dark:text-gray-300',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
  };

  return (
    <div className={`p-4 rounded-lg ${colorClasses[color]}`}>
      <p className="text-sm font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
