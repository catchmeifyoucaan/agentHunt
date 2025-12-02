'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { programsApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Globe, Shield, Database, Activity, AlertTriangle, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useEventStream } from '@/hooks/useWebSocket';
import { useEffect } from 'react';

export default function ProgramDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const programId = params.id as string;
  const queryClient = useQueryClient();
  const { events } = useEventStream({ programId });

  const { data: programData, isLoading: programLoading } = useQuery({
    queryKey: ['program', programId],
    queryFn: () => programsApi.get(programId),
    refetchInterval: false, // Disable auto-refresh
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['program-stats', programId],
    queryFn: async () => {
      const response = await programsApi.getStats(programId);
      return response.data;
    },
    refetchInterval: false, // Disable polling - use WebSocket
  });

  const pauseProgramMutation = useMutation({
    mutationFn: () => programsApi.pause(programId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', programId] });
    },
  });

  const resumeProgramMutation = useMutation({
    mutationFn: () => programsApi.resume(programId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['program', programId] });
    },
  });
  
  // Refetch on WebSocket events
  useEffect(() => {
    const programEvent = events.find(e => 
      e.type === 'program:jobs' || 
      e.type === 'program:findings' ||
      e.type === 'job-status-update' ||
      e.type === 'finding'
    );
    if (programEvent) {
      queryClient.invalidateQueries({ queryKey: ['program-stats', programId] });
    }
  }, [events, queryClient, programId]);

  if (programLoading || statsLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading program details...</p>
        </div>
      </div>
    );
  }

  const program = programData?.data?.program;
  const stats = statsData?.stats;

  if (!program) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-16 h-16 mx-auto text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Program Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The program you're looking for doesn't exist or has been deleted.
            </p>
            <Link href="/programs">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Programs
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const externalPercent = stats?.subdomains?.total > 0
    ? Math.round((stats.subdomains.external / stats.subdomains.total) * 100)
    : 0;
  const internalPercent = stats?.subdomains?.total > 0
    ? Math.round((stats.subdomains.internal / stats.subdomains.total) * 100)
    : 0;
  const untaggedPercent = stats?.subdomains?.total > 0
    ? Math.round((stats.subdomains.untagged / stats.subdomains.total) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/programs">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{program.name}</h1>
            <p className="text-muted-foreground mt-1">
              {program.platform} • {program.scope?.domains?.length || 0} domains in scope
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {program.paused ? (
            <Button
              variant="outline"
              onClick={() => resumeProgramMutation.mutate()}
              disabled={resumeProgramMutation.isPending}
            >
              <Play className="w-4 h-4 mr-2" />
              Resume Program
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => pauseProgramMutation.mutate()}
              disabled={pauseProgramMutation.isPending}
            >
              <Pause className="w-4 h-4 mr-2" />
              Pause Program
            </Button>
          )}
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            {program.platform}
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Subdomains</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.subdomains?.total?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.assetsByType?.domain || 0} root domains
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Globe className="w-4 h-4" />
              External (Public)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats?.subdomains?.external?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {externalPercent}% of total • HTTP scanned
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Internal (Infrastructure)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{stats?.subdomains?.internal?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {internalPercent}% of total • Port scan only
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Database className="w-4 h-4" />
              Untagged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-600">{stats?.subdomains?.untagged?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {untaggedPercent}% of total • Pending tagging
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Asset Types Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Asset Types
          </CardTitle>
          <CardDescription>Breakdown of discovered assets by type</CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.assetsByType && Object.keys(stats.assetsByType).length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {Object.entries(stats.assetsByType).map(([type, count]) => (
                <div key={type} className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
                  <div className="text-sm font-semibold text-muted-foreground capitalize mb-1">
                    {type}
                  </div>
                  <div className="text-2xl font-bold">{(count as number).toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No assets discovered yet</p>
          )}
        </CardContent>
      </Card>

      {/* Findings by Severity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Findings by Severity
          </CardTitle>
          <CardDescription>Vulnerabilities discovered across all scans</CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.findingsBySeverity && Object.keys(stats.findingsBySeverity).length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {['critical', 'high', 'medium', 'low', 'info'].map((severity) => {
                const count = stats.findingsBySeverity[severity] || 0;
                const colorMap: Record<string, string> = {
                  critical: 'text-red-600 bg-red-50 dark:bg-red-950',
                  high: 'text-orange-600 bg-orange-50 dark:bg-orange-950',
                  medium: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950',
                  low: 'text-blue-600 bg-blue-50 dark:bg-blue-950',
                  info: 'text-gray-600 bg-gray-50 dark:bg-gray-900',
                };
                return (
                  <div key={severity} className={`${colorMap[severity]} p-4 rounded-lg`}>
                    <div className="text-sm font-semibold capitalize mb-1">{severity}</div>
                    <div className="text-3xl font-bold">{count}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No findings yet</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Job Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Job Activity
          </CardTitle>
          <CardDescription>Jobs run in the last 24 hours</CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.recentJobs && stats.recentJobs.length > 0 ? (
            <div className="space-y-2">
              {stats.recentJobs.map((job: any, idx: number) => {
                const statusColors: Record<string, string> = {
                  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
                  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
                };
                return (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold capitalize">{job.type}</span>
                      <Badge className={statusColors[job.status] || 'bg-gray-100 text-gray-800'}>
                        {job.status}
                      </Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">{job.count} job(s)</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No recent activity</p>
          )}
        </CardContent>
      </Card>

      {/* Scope Details */}
      <Card>
        <CardHeader>
          <CardTitle>Scope</CardTitle>
          <CardDescription>Domains and targets in scope for this program</CardDescription>
        </CardHeader>
        <CardContent>
          {program.scope?.domains && program.scope.domains.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {program.scope.domains.map((domain: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <code className="text-sm">{domain}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No domains in scope</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
