'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useEventStream } from '@/hooks/useWebSocket';
import { 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Activity,
  Clock,
  Loader2,
  RefreshCw,
  Zap,
  BarChart3
} from 'lucide-react';

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  avgDuration: number;
}

interface Bottleneck {
  agentType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  issue: string;
  recommendation: string;
  currentValue: number;
  threshold: number;
}

interface PerformanceBottleneckUIProps {
  programId?: string;
}

const PerformanceBottleneckUI: React.FC<PerformanceBottleneckUIProps> = ({ programId }) => {
  const [queueStats, setQueueStats] = useState<QueueStats[]>([]);
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { events } = useEventStream({ programId });

  const fetchPerformanceData = async () => {
    setLoading(true);
    try {
      const [statsResponse, bottlenecksResponse] = await Promise.all([
        fetch('/api/v1/jobs/queue-stats'),
        fetch(`/api/v1/manager/performance/bottlenecks${programId ? `?programId=${programId}` : ''}`),
      ]);

      if (!statsResponse.ok || !bottlenecksResponse.ok) {
        throw new Error('Failed to fetch performance data');
      }

      const statsData = await statsResponse.json();
      const bottlenecksData = await bottlenecksResponse.json();

      setQueueStats(statsData.queues || []);
      setBottlenecks(bottlenecksData.bottlenecks || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch performance data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformanceData();
    // No more polling - WebSocket will update in real-time
  }, [programId]);

  // Update on WebSocket events
  useEffect(() => {
    const queueEvent = events.find(e => e.type === 'program:jobs' || e.type === 'job-status-update');
    if (queueEvent) {
      fetchPerformanceData();
    }
  }, [events]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default:
        return <Activity className="w-5 h-5 text-yellow-500" />;
    }
  };

  // Calculate total queue depth
  const totalQueueDepth = queueStats.reduce((sum, q) => sum + q.waiting, 0);
  const totalActive = queueStats.reduce((sum, q) => sum + q.active, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Performance Bottleneck Detection
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchPerformanceData}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && bottlenecks.length === 0 ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Overall Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="text-sm text-muted-foreground mb-1">Total Queue Depth</div>
                  <div className="text-3xl font-bold text-blue-600">{totalQueueDepth}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {totalActive} active jobs
                  </div>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="text-sm text-muted-foreground mb-1">Healthy Queues</div>
                  <div className="text-3xl font-bold text-green-600">
                    {queueStats.filter(q => q.waiting < 50 && q.active < 10).length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    of {queueStats.length} total
                  </div>
                </div>
                <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="text-sm text-muted-foreground mb-1">Bottlenecks</div>
                  <div className="text-3xl font-bold text-yellow-600">{bottlenecks.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {bottlenecks.filter(b => b.severity === 'critical' || b.severity === 'high').length} critical
                  </div>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="text-sm text-muted-foreground mb-1">Avg Duration</div>
                  <div className="text-3xl font-bold text-purple-600">
                    {queueStats.length > 0
                      ? Math.round(queueStats.reduce((sum, q) => sum + q.avgDuration, 0) / queueStats.length)
                      : 0}s
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    across all queues
                  </div>
                </div>
              </div>

              {/* Bottlenecks */}
              {bottlenecks.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-4">Detected Bottlenecks</h3>
                  <div className="space-y-3">
                    {bottlenecks
                      .sort((a, b) => {
                        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                        return severityOrder[a.severity] - severityOrder[b.severity];
                      })
                      .map((bottleneck, index) => (
                        <div
                          key={index}
                          className={`p-4 rounded-lg border-2 ${getSeverityColor(bottleneck.severity)}`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 flex-1">
                              {getSeverityIcon(bottleneck.severity)}
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="font-bold text-lg">{bottleneck.agentType}</span>
                                  <Badge variant={bottleneck.severity === 'critical' ? 'destructive' : 'secondary'}>
                                    {bottleneck.severity}
                                  </Badge>
                                </div>
                                <p className="text-sm mb-2">{bottleneck.issue}</p>
                                <div className="flex items-center gap-4 text-xs">
                                  <span>
                                    Current: <strong>{bottleneck.currentValue}</strong>
                                  </span>
                                  <span>
                                    Threshold: <strong>{bottleneck.threshold}</strong>
                                  </span>
                                  {bottleneck.currentValue > bottleneck.threshold && (
                                    <span className="text-red-600 flex items-center gap-1">
                                      <TrendingUp className="w-3 h-3" />
                                      {Math.round(((bottleneck.currentValue - bottleneck.threshold) / bottleneck.threshold) * 100)}% over
                                    </span>
                                  )}
                                </div>
                                <div className="mt-3 p-2 bg-white/50 rounded text-sm">
                                  <strong>Recommendation:</strong> {bottleneck.recommendation}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Queue Details */}
              <div>
                <h3 className="font-semibold text-lg mb-4">Queue Status</h3>
                <div className="space-y-2">
                  {queueStats
                    .sort((a, b) => b.waiting - a.waiting)
                    .map((queue) => {
                      const isBottleneck = queue.waiting > 50 || queue.active > 10;
                      return (
                        <div
                          key={queue.name}
                          className={`p-3 rounded-lg border ${
                            isBottleneck
                              ? 'bg-red-50 border-red-200'
                              : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Activity className={`w-4 h-4 ${isBottleneck ? 'text-red-500' : 'text-green-500'}`} />
                              <span className="font-medium">{queue.name}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <Clock className="w-4 h-4 text-muted-foreground" />
                                <span className={queue.waiting > 50 ? 'text-red-600 font-bold' : ''}>
                                  {queue.waiting} waiting
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Zap className="w-4 h-4 text-muted-foreground" />
                                <span>{queue.active} active</span>
                              </div>
                              <div className="text-muted-foreground">
                                {queue.avgDuration}s avg
                              </div>
                            </div>
                          </div>
                          {isBottleneck && (
                            <div className="mt-2 text-xs text-red-600">
                              ⚠️ High queue depth detected - consider scaling
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {bottlenecks.length === 0 && queueStats.length > 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No bottlenecks detected</p>
                  <p className="text-sm mt-2">All queues are operating within normal parameters</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PerformanceBottleneckUI;
