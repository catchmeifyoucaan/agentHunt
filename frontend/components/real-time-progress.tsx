'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Clock, Play, Loader2 } from 'lucide-react';

interface ProgressStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  progress: number; // 0-100
  estimatedDuration?: number; // in seconds
  actualDuration?: number; // in seconds
  error?: string;
  startTime?: Date;
  endTime?: Date;
}

interface JobProgress {
  id: string;
  jobId: string;
  phase: string;
  currentStep: number;
  overallProgress: number; // 0-100
  estimatedCompletion?: Date;
  created_at: Date;
  updated_at: Date;
  steps: ProgressStep[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
}

interface RealTimeProgressProps {
  jobId?: string;
  initialProgress?: JobProgress;
}

const RealTimeProgressTracker: React.FC<RealTimeProgressProps> = ({ 
  jobId: initialJobId, 
  initialProgress 
}) => {
  const [progress, setProgress] = useState<JobProgress | null>(initialProgress || null);
  const [jobId, setJobId] = useState(initialJobId || '');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (initialProgress) {
      setProgress(initialProgress);
    }
  }, [initialProgress]);

  // In a real implementation, we would connect to WebSocket or use Server-Sent Events
  // For now, we'll simulate real-time updates
  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(() => {
      // Simulate progress updates
      fetchProgressUpdate();
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [jobId]);

  const fetchProgressUpdate = async () => {
    if (!jobId) return;
    
    try {
      // In a real implementation, this would fetch from:
      // 1. WebSocket connection
      // 2. API endpoint that streams updates
      // 3. Server-sent events
      
      // For now, we'll simulate an update
      if (progress) {
        setProgress(prev => {
          if (!prev) return null;
          
          // Simulate progress advancement
          const newSteps = prev.steps.map((step, index) => {
            if (step.status === 'pending' && index === prev.currentStep) {
              return { ...step, status: 'running' as const, progress: Math.min(step.progress + 10, 80) };
            }
            if (step.status === 'running' && step.progress < 100) {
              return { ...step, progress: Math.min(step.progress + 5, 100) };
            }
            return step;
          });
          
          // Calculate overall progress
          const completedSteps = newSteps.filter(s => s.status === 'completed').length;
          const totalProgress = Math.min(
            Math.round((completedSteps / newSteps.length) * 100),
            100
          );
          
          return {
            ...prev,
            steps: newSteps,
            overallProgress: totalProgress,
            currentStep: completedSteps
          };
        });
      }
    } catch (error) {
      console.error('Failed to fetch progress update:', error);
    }
  };

  const startTracking = () => {
    if (!jobId) {
      toast({
        title: 'Error',
        description: 'Please enter a job ID to track',
        variant: 'destructive',
      });
      return;
    }
    
    setLoading(true);
    // In a real implementation, we would connect to the job tracking API
    // For now, we'll simulate loading
    setTimeout(() => {
      setLoading(false);
      setProgress({
        id: 'simulated-progress-1',
        jobId: jobId,
        phase: 'Execution',
        currentStep: 1,
        overallProgress: 25,
        estimatedCompletion: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
        created_at: new Date(),
        updated_at: new Date(),
        status: 'running',
        steps: [
          {
            id: 'step-1',
            name: 'Initialize scanner',
            status: 'completed',
            progress: 100,
            actualDuration: 15,
            startTime: new Date(Date.now() - 15000),
            endTime: new Date(Date.now() - 1000)
          },
          {
            id: 'step-2',
            name: 'Discover endpoints',
            status: 'running',
            progress: 45,
            estimatedDuration: 120,
            startTime: new Date(Date.now() - 30000),
          },
          {
            id: 'step-3',
            name: 'Run vulnerability scans',
            status: 'pending',
            progress: 0,
            estimatedDuration: 300,
          },
          {
            id: 'step-4',
            name: 'Analyze results',
            status: 'pending',
            progress: 0,
            estimatedDuration: 60,
          },
          {
            id: 'step-5',
            name: 'Generate report',
            status: 'pending',
            progress: 0,
            estimatedDuration: 30,
          }
        ]
      });
      
      toast({
        title: 'Tracking Started',
        description: `Started tracking job: ${jobId}`,
      });
    }, 1000);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'paused':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'paused': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span>Real-time Job Progress</span>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Job ID"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            />
            <Button onClick={startTracking} disabled={loading} className="flex items-center gap-2">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Track
                </>
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {progress ? (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">{progress.phase} Progress</h3>
                <p className="text-sm text-gray-500">Job ID: {progress.jobId}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{progress.overallProgress}%</div>
                <div className="text-sm text-gray-500">
                  {progress.estimatedCompletion 
                    ? `Est. completion: ${progress.estimatedCompletion.toLocaleTimeString()}` 
                    : 'Calculating...'}
                </div>
              </div>
            </div>

            <Progress value={progress.overallProgress} className="h-3" />

            <div className="space-y-4">
              <h4 className="font-medium">Progress Steps:</h4>
              
              {progress.steps.map((step, index) => (
                <motion.div
                  key={step.id}
                  className={`p-4 rounded-lg border ${
                    step.status === 'completed' ? 'bg-green-50 border-green-200' :
                    step.status === 'failed' ? 'bg-red-50 border-red-200' :
                    step.status === 'running' ? 'bg-blue-50 border-blue-200' :
                    'bg-gray-50 border-gray-200'
                  }`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100">
                        {getStatusIcon(step.status)}
                      </div>
                      <div>
                        <div className="font-medium">{step.name}</div>
                        <div className="text-sm text-gray-500">
                          {step.status === 'running' && step.progress > 0 ? `${step.progress}%` : 
                           step.status === 'failed' ? 'Failed' : 
                           step.status === 'completed' ? 'Completed' : 'Pending'}
                        </div>
                      </div>
                    </div>
                    
                    <Badge className={getStatusColor(step.status)}>
                      {step.status}
                    </Badge>
                  </div>
                  
                  {step.status === 'running' && (
                    <div className="mt-2">
                      <Progress value={step.progress} className="h-2" />
                      {step.estimatedDuration && (
                        <div className="text-xs text-gray-500 mt-1">
                          Estimated duration: {Math.round(step.estimatedDuration / 60)}m
                          {step.startTime && (
                            <span className="ml-2">
                              Elapsed: {Math.round((Date.now() - step.startTime.getTime()) / 1000 / 60)}m
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {step.status === 'failed' && step.error && (
                    <div className="mt-2 p-2 bg-red-100 text-red-700 rounded text-sm">
                      Error: {step.error}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>Enter a job ID to track real-time progress</p>
            <p className="text-sm mt-2">The progress tracker will update automatically as the job executes</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RealTimeProgressTracker;