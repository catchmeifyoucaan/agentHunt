'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useJobProgress } from '@/hooks/useProgressTracking';

interface JobProgressCardProps {
  jobId: string;
  title?: string;
}

export function JobProgressCard({ jobId, title }: JobProgressCardProps) {
  const { isConnected, progress } = useJobProgress(jobId);

  if (!progress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {title || 'Job Progress'}
            {!isConnected && (
              <Badge variant="outline" className="text-xs">
                Disconnected
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Waiting for progress updates...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            {title || progress.phase}
            {!isConnected && (
              <Badge variant="outline" className="text-xs">
                Disconnected
              </Badge>
            )}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {progress.overallProgress}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Progress */}
        <div>
          <Progress value={progress.overallProgress} className="h-2" />
          {progress.estimatedCompletion && (
            <div className="text-xs text-muted-foreground mt-1">
              Est. completion:{' '}
              {new Date(progress.estimatedCompletion).toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {progress.steps.map((step, index) => {
            const Icon =
              step.status === 'completed'
                ? CheckCircle2
                : step.status === 'in_progress'
                ? Loader2
                : step.status === 'failed'
                ? XCircle
                : Circle;

            const iconColor =
              step.status === 'completed'
                ? 'text-green-500'
                : step.status === 'in_progress'
                ? 'text-blue-500'
                : step.status === 'failed'
                ? 'text-red-500'
                : 'text-gray-400';

            return (
              <div key={index} className="flex items-start gap-3">
                <Icon
                  className={`w-5 h-5 mt-0.5 flex-shrink-0 ${iconColor} ${
                    step.status === 'in_progress' ? 'animate-spin' : ''
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {step.name}
                    </span>
                    {step.progress !== undefined && step.status === 'in_progress' && (
                      <span className="text-xs text-muted-foreground">
                        {step.progress}%
                      </span>
                    )}
                  </div>
                  {step.status === 'in_progress' && step.progress !== undefined && (
                    <Progress value={step.progress} className="h-1 mt-1" />
                  )}
                  {step.error && (
                    <div className="text-xs text-red-500 mt-1">{step.error}</div>
                  )}
                  {step.startTime && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Started: {new Date(step.startTime).toLocaleTimeString()}
                      {step.endTime &&
                        ` • Completed: ${new Date(step.endTime).toLocaleTimeString()}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
