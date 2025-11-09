'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { programsApi, jobsApi, integrationsApi, managerApi } from '@/lib/api';
import {
  Activity, AlertTriangle, FolderOpen, Target,
  Plus, Download, Upload, PlayCircle, Settings,
  Sparkles, Zap, Clock, Grid3x3
} from 'lucide-react';
import { AssetDropzone, type ParsedAsset } from '@/components/AssetDropzone';
import { JobQueueManager } from '@/components/JobQueueManager';
import { AgentGrid } from '@/components/AgentCard';
import { getAllAgents, AGENT_CATEGORIES } from '@/lib/agentMetadata';
import { AgentType } from '@/shared/types';
import Link from 'next/link';

export default function EnhancedDashboard() {
  const queryClient = useQueryClient();
  const [showWelcome, setShowWelcome] = useState(true);
  const [showAssetDropzone, setShowAssetDropzone] = useState(false);
  const [showPlatformImport, setShowPlatformImport] = useState(false);
  const [showJobQueue, setShowJobQueue] = useState(false);
  const [showAgents, setShowAgents] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const [jobSequence, setJobSequence] = useState<JobSequenceItem[]>([]);

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => jobsApi.list({ limit: 10 }),
    refetchInterval: 5000,
  });

  const { data: queueStats } = useQuery({
    queryKey: ['queue-stats'],
    queryFn: () => jobsApi.getQueueStats(),
    refetchInterval: 5000,
  });

  const createJobMutation = useMutation({
    mutationFn: (data: any) => jobsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const startRecoveryMutation = useMutation({
    mutationFn: (programId: string) =>
      managerApi.sendCommand({
        command: `start recovery for program ${programId}`,
        program_id: programId,
        user_id: 'default',
      }),
  });

  const programs = programsData?.data?.programs || [];
  const jobs = jobsData?.data?.jobs || [];
  const activeJobs = jobs.filter((j: any) => j.status === 'active');

  // Compute agent stats from jobs
  const agentStats = jobs.reduce((acc: Record<AgentType, any>, job: any) => {
    const type = job.type as AgentType;
    if (!acc[type]) {
      acc[type] = {
        total: 0,
        active: 0,
        completed: 0,
        failed: 0,
        queued: 0,
        avgDuration: 0,
      };
    }
    acc[type].total++;
    if (job.status === 'active') acc[type].active++;
    if (job.status === 'completed') acc[type].completed++;
    if (job.status === 'failed') acc[type].failed++;
    if (job.status === 'waiting') acc[type].queued++;
    return acc;
  }, {} as Record<AgentType, any>);

  const allAgents = getAllAgents().map(a => a.type);

  const handleAssetsAdded = async (assets: ParsedAsset[]) => {
    if (!selectedProgram) {
      alert('Please select a program first');
      return;
    }

    // Group assets by type
    const grouped = assets.reduce((acc, asset) => {
      if (!acc[asset.type]) acc[asset.type] = [];
      acc[asset.type].push(asset.value);
      return acc;
    }, {} as Record<string, string[]>);

    // Create jobs based on asset types
    for (const [type, values] of Object.entries(grouped)) {
      let jobType = '';

      switch (type) {
        case 'url':
          jobType = 'crawl';
          break;
        case 'subdomain':
          jobType = 'subdomain-enumeration';
          break;
        case 'domain':
          jobType = 'discovery';
          break;
        case 'ip':
          jobType = 'portscan';
          break;
      }

      if (jobType) {
        await createJobMutation.mutateAsync({
          type: jobType,
          program_id: selectedProgram,
          options: {
            targets: values,
          },
        });
      }
    }

    alert(`Created jobs for ${assets.length} assets!`);
    setShowAssetDropzone(false);
  };

  const handleStartRecovery = () => {
    if (!selectedProgram) {
      alert('Please select a program first');
      return;
    }
    startRecoveryMutation.mutate(selectedProgram);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Welcome Section */}
      {showWelcome && (
        <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-lg p-6 relative">
          <button
            onClick={() => setShowWelcome(false)}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/10 rounded-lg">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Welcome to AgentHunt</h2>
              <p className="text-muted-foreground mb-4">
                Your AI-powered security orchestration platform. Start by creating a program,
                importing targets from HackerOne or Chaos DB, or drop asset files to begin hunting.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowAssetDropzone(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Upload Assets
                </button>
                <button
                  onClick={() => setShowPlatformImport(true)}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Import from Platform
                </button>
                <Link
                  href="/programs"
                  className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:bg-accent/80 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Program
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Monitor and control your security operations
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            className="px-4 py-2 bg-background border border-border rounded-md"
          >
            <option value="">Select Program</option>
            {programs.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleStartRecovery}
            disabled={!selectedProgram}
            className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Start Recovery
          </button>
          <button
            onClick={() => setShowJobQueue(!showJobQueue)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
          >
            <Clock className="w-4 h-4" />
            Job Queue
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Active Programs"
          value={programs.length}
          icon={FolderOpen}
          color="blue"
        />
        <StatCard
          title="Active Jobs"
          value={activeJobs.length}
          icon={Activity}
          color="green"
        />
        <StatCard
          title="Total Assets"
          value={programs.reduce((sum: number, p: any) => sum + (p.asset_count || 0), 0)}
          icon={Target}
          color="purple"
        />
        <StatCard
          title="Findings"
          value={programs.reduce((sum: number, p: any) => sum + (p.finding_count || 0), 0)}
          icon={AlertTriangle}
          color="red"
        />
      </div>

      {/* Agents Section */}
      {showAgents && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Grid3x3 className="w-6 h-6" />
              <div>
                <h2 className="text-lg font-semibold">Security Agents</h2>
                <p className="text-sm text-muted-foreground">
                  17 specialized agents for reconnaissance, scanning, exploitation, and analysis
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAgents(false)}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Hide
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                selectedCategory === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              All Agents ({allAgents.length})
            </button>
            {Object.entries(AGENT_CATEGORIES).map(([key, category]) => {
              const count = allAgents.filter(
                (type) => getAllAgents().find((a) => a.type === type)?.category === key
              ).length;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedCategory(key)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    selectedCategory === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  {category.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Agent Grid */}
          <AgentGrid
            agents={
              selectedCategory === 'all'
                ? allAgents
                : allAgents.filter(
                    (type) => getAllAgents().find((a) => a.type === type)?.category === selectedCategory
                  )
            }
            statsMap={agentStats}
            onCreateJob={(agentType) => {
              // Navigate to job creation with pre-selected agent type
              window.location.href = `/jobs/create?type=${agentType}`;
            }}
          />
        </div>
      )}

      {!showAgents && (
        <div className="text-center">
          <button
            onClick={() => setShowAgents(true)}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 flex items-center gap-2 mx-auto"
          >
            <Grid3x3 className="w-4 h-4" />
            Show Agents
          </button>
        </div>
      )}

      {/* Job Queue Manager */}
      {showJobQueue && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Job Queue Management</h2>
          <JobQueueManager />
        </div>
      )}

      {/* Asset Dropzone Modal */}
      {showAssetDropzone && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Upload Assets</h2>
              <button
                onClick={() => setShowAssetDropzone(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            {!selectedProgram ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">Please select a program first</p>
                <button
                  onClick={() => setShowAssetDropzone(false)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
                >
                  Select Program
                </button>
              </div>
            ) : (
              <AssetDropzone onAssetsAdded={handleAssetsAdded} />
            )}
          </div>
        </div>
      )}

      {/* Platform Import Modal */}
      {showPlatformImport && (
        <PlatformImportModal
          onClose={() => setShowPlatformImport(false)}
          selectedProgram={selectedProgram}
        />
      )}

      {/* Active Jobs */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Active Jobs</h2>
          <Link href="/jobs" className="text-sm text-primary hover:underline">
            View All →
          </Link>
        </div>
        {activeJobs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No active jobs. Upload assets or start a scan to begin!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeJobs.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between p-4 bg-accent/50 rounded-md">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <p className="text-sm font-medium">{job.type}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Started {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                    Priority: {job.priority || 5}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Queue Stats */}
      {queueStats && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Queue Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Object.entries(queueStats.data.queues || {}).map(([name, stats]: [string, any]) => (
              <div key={name} className="p-4 bg-accent/50 rounded-md">
                <p className="text-xs text-muted-foreground uppercase truncate" title={name}>
                  {name}
                </p>
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

function StatCard({ title, value, icon: Icon, color }: {
  title: string;
  value: number;
  icon: any;
  color: 'blue' | 'green' | 'purple' | 'red';
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    purple: 'bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    red: 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function PlatformImportModal({ onClose, selectedProgram }: any) {
  const [platform, setPlatform] = useState<'hackerone' | 'bugcrowd' | 'chaos' | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    if (!selectedProgram) {
      alert('Please select a program first');
      return;
    }

    setImporting(true);
    try {
      if (platform === 'hackerone') {
        await integrationsApi.hackerOne.sync(selectedProgram);
      } else if (platform === 'bugcrowd') {
        await integrationsApi.bugcrowd.sync(selectedProgram);
      }
      alert('Import started successfully!');
      onClose();
    } catch (error: any) {
      alert(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Import from Platform</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select Platform</label>
            <div className="space-y-2">
              <button
                onClick={() => setPlatform('hackerone')}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  platform === 'hackerone'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <p className="font-medium">HackerOne</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Import bug bounty programs and scopes
                </p>
              </button>
              <button
                onClick={() => setPlatform('bugcrowd')}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  platform === 'bugcrowd'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <p className="font-medium">Bugcrowd</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Import programs from Bugcrowd platform
                </p>
              </button>
              <button
                onClick={() => setPlatform('chaos')}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  platform === 'chaos'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <p className="font-medium">Chaos DB</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Import from ProjectDiscovery's Chaos dataset
                </p>
              </button>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!platform || !selectedProgram || importing}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface JobSequenceItem {
  id: string;
  type: string;
  dependsOn?: string;
}
