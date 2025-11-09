'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Terminal, Clock, Database, Settings } from 'lucide-react';

interface JobCommandViewerProps {
  job: any;
}

export function JobCommandViewer({ job }: JobCommandViewerProps) {
  if (!job) return null;

  const getAgentCommand = (type: string, options: any) => {
    switch (type) {
      case 'subdomain':
        return `subfinder + amass on ${options?.domains?.length || 0} domains`;
      case 'discovery':
        return `chaos + subfinder + uncover for discovery`;
      case 'fingerprint':
        return `httpx + tlsx on ${options?.assets?.length || 0} targets`;
      case 'crawl':
        return `katana depth=${options?.depth || 3} maxUrls=${options?.maxUrls || 1000}`;
      case 'portscan':
        return `naabu ports=${options?.ports || '1-10000'} rate=${options?.rate || 1000}`;
      case 'scanner':
        return `nuclei template=${options?.templateSet || 'fast'} concurrency=${options?.concurrency || 25}`;
      default:
        return `${type} agent running`;
    }
  };

  const getTargetInfo = (type: string, options: any) => {
    switch (type) {
      case 'subdomain':
      case 'discovery':
        return `${options?.domains?.length || 0} domains`;
      case 'fingerprint':
        return `${options?.assets?.length || 0} assets`;
      case 'crawl':
        return `${options?.targetUrls?.length || 0} URLs`;
      case 'portscan':
        return `${options?.targets?.length || 0} targets`;
      case 'scanner':
        return `Scanning from crawl results`;
      default:
        return 'N/A';
    }
  };

  const getElapsedTime = () => {
    if (!job.started_at) return 'Not started';

    const start = new Date(job.started_at).getTime();
    const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
    const elapsed = Math.floor((end - start) / 1000);

    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const getResultSummary = () => {
    if (!job.result) return null;

    if (typeof job.result === 'object') {
      const keys = Object.keys(job.result);
      return keys.map(key => (
        <div key={key} className="flex justify-between text-sm">
          <span className="text-muted-foreground capitalize">{key}:</span>
          <span className="font-mono">{job.result[key]}</span>
        </div>
      ));
    }

    return <p className="text-sm font-mono">{JSON.stringify(job.result)}</p>;
  };

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-lg">Command Details</CardTitle>
          </div>
          <Badge variant={job.status === 'active' ? 'default' : job.status === 'completed' ? 'secondary' : 'destructive'}>
            {job.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Command Info */}
        <div className="bg-gray-950 text-gray-100 p-4 rounded-lg font-mono text-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-green-400">$</span>
            <span className="text-blue-400">{job.type}</span>
          </div>
          <div className="pl-4 text-gray-300">
            {getAgentCommand(job.type, job.options)}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Target Info */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="w-4 h-4" />
              <span>Targets</span>
            </div>
            <p className="text-lg font-semibold">{getTargetInfo(job.type, job.options)}</p>
          </div>

          {/* Time */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>Elapsed</span>
            </div>
            <p className="text-lg font-semibold">{getElapsedTime()}</p>
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Settings className="w-4 h-4" />
              <span>Priority</span>
            </div>
            <p className="text-lg font-semibold">{job.priority || 5}/10</p>
          </div>

          {/* Attempts */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Terminal className="w-4 h-4" />
              <span>Attempts</span>
            </div>
            <p className="text-lg font-semibold">{job.attempts || 0}/{job.max_attempts || 3}</p>
          </div>
        </div>

        {/* Results */}
        {job.result && job.status === 'completed' && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold mb-3">Results</h4>
            <div className="space-y-2 bg-muted p-3 rounded-lg">
              {getResultSummary()}
            </div>
          </div>
        )}

        {/* Options */}
        {job.options && Object.keys(job.options).length > 0 && (
          <details className="border-t pt-4">
            <summary className="text-sm font-semibold cursor-pointer hover:text-primary">
              View Full Configuration
            </summary>
            <pre className="mt-3 text-xs bg-gray-950 text-gray-100 p-3 rounded-lg overflow-x-auto">
              {JSON.stringify(job.options, null, 2)}
            </pre>
          </details>
        )}

        {/* Error */}
        {job.error && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold mb-2 text-red-500">Error</h4>
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 rounded-lg">
              <p className="text-sm font-mono text-red-700 dark:text-red-400">{job.error}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
