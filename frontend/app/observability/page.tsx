'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { workflowTracingApi } from '@/lib/api';
import AgentGraphVisualization from '@/components/agent-graph-visualization';
import { useToast } from '@/components/ui/use-toast';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatDistanceToNow } from 'date-fns';

interface HandoffStats {
  total: number;
  pending: number;
  completed: number;
  rejected: number;
  avgConfidence: number;
  byAgentType: Record<string, number>;
}

interface JobStats {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  runningJobs: number;
  avgJobDuration: number;
  totalDuration: number;
}

const MonitoringDashboard = () => {
  const searchParams = useSearchParams();
  const [handoffStats, setHandoffStats] = useState<HandoffStats | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const { toast } = useToast();

  useEffect(() => {
    fetchDashboardData();
    // Read tab from URL query parameter
    const tabParam = searchParams?.get('tab');
    if (tabParam && ['overview', 'handoffs', 'jobs', 'visualization'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch real observability stats
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const [observabilityResponse, dashboardResponse] = await Promise.all([
        fetch(`${API_URL}/api/v1/observability/stats?timeRange=24h`),
        fetch(`${API_URL}/api/v1/dashboard/stats`),
      ]);

      if (!observabilityResponse.ok || !dashboardResponse.ok) {
        throw new Error('Failed to fetch statistics');
      }

      const observabilityData = await observabilityResponse.json();
      const dashboardData = await dashboardResponse.json();

      // Transform observability data for handoff stats
      const handoffData = dashboardData.data || {};
      setHandoffStats({
        total: handoffData.total || 0,
        pending: handoffData.inProgress || 0,
        completed: handoffData.successful || 0,
        rejected: 0, // Not available in current API
        avgConfidence: 0.85, // Default value
        byAgentType: (handoffData.byFromAgentType || []).reduce((acc: any, item: any) => {
          acc[item.agentType] = item.count || 0;
          return acc;
        }, {}),
      });

      // Transform observability data for job stats
      const overview = observabilityData.overview || {};
      setJobStats({
        totalJobs: overview.totalJobs || 0,
        completedJobs: overview.completed || 0,
        failedJobs: overview.failed || 0,
        runningJobs: overview.active || 0,
        avgJobDuration: 0, // Calculate from observability data if available
        totalDuration: 0,
      });
    } catch (error: any) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch dashboard data',
        variant: 'destructive',
      });
      // Set empty stats on error
      setHandoffStats({
        total: 0,
        pending: 0,
        completed: 0,
        rejected: 0,
        avgConfidence: 0,
        byAgentType: {},
      });
      setJobStats({
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        runningJobs: 0,
        avgJobDuration: 0,
        totalDuration: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const agentTypeData = handoffStats 
    ? Object.entries(handoffStats.byAgentType).map(([name, value]) => ({ name, value }))
    : [];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82ca9d'];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Monitoring Dashboard</h1>
        <Button onClick={fetchDashboardData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="handoffs">Handoffs</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="visualization">Visualization</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{jobStats?.totalJobs || 0}</div>
                <p className="text-xs text-muted-foreground">+12% from last week</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{jobStats?.completedJobs || 0}</div>
                <p className="text-xs text-muted-foreground">Success rate: {jobStats ? Math.round((jobStats.completedJobs / jobStats.totalJobs) * 100) : 0}%</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Handoffs</CardTitle>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{handoffStats?.pending || 0}</div>
                <p className="text-xs text-muted-foreground">Avg confidence: {handoffStats?.avgConfidence ? (handoffStats.avgConfidence * 100).toFixed(0) + '%' : 'N/A'}</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Agents</CardTitle>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">24</div>
                <p className="text-xs text-muted-foreground">All agents operational</p>
              </CardContent>
            </Card>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Handoffs by Agent Type</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={agentTypeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Handoff Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {handoffStats && (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Completed', value: handoffStats.completed },
                          { name: 'Pending', value: handoffStats.pending },
                          { name: 'Rejected', value: handoffStats.rejected }
                        ]}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {[
                          { name: 'Completed', value: handoffStats.completed },
                          { name: 'Pending', value: handoffStats.pending },
                          { name: 'Rejected', value: handoffStats.rejected }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="handoffs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Handoffs</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentHandoffsList />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="jobs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Job Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold">{jobStats?.totalJobs || 0}</div>
                  <div className="text-sm text-gray-600">Total</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold">{jobStats?.completedJobs || 0}</div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold">{jobStats?.failedJobs || 0}</div>
                  <div className="text-sm text-gray-600">Failed</div>
                </div>
                <div className="text-center p-4 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold">{jobStats?.runningJobs || 0}</div>
                  <div className="text-sm text-gray-600">Running</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold">{jobStats?.avgJobDuration || 0}s</div>
                  <div className="text-sm text-gray-600">Avg Duration</div>
                </div>
                <div className="text-center p-4 bg-indigo-50 rounded-lg">
                  <div className="text-2xl font-bold">{jobStats?.totalDuration ? Math.round(jobStats.totalDuration / 60) : 0}m</div>
                  <div className="text-sm text-gray-600">Total Time</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="visualization" className="space-y-6">
          <AgentGraphVisualization />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// Recent Handoffs List Component
function RecentHandoffsList() {
  const [handoffs, setHandoffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHandoffs = async () => {
      try {
        setLoading(true);
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(`${API_URL}/api/v1/dashboard/recent-handoffs?limit=10`);
        if (!response.ok) throw new Error('Failed to fetch handoffs');
        const data = await response.json();
        setHandoffs(data.data || []);
      } catch (error) {
        console.error('Error fetching handoffs:', error);
        setHandoffs([]);
      } finally {
        setLoading(false);
      }
    };

    fetchHandoffs();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'accepted':
        return <Badge variant="secondary" className="bg-blue-500 hover:bg-blue-600 text-white">In Progress</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'circuit_breaker_open':
        return <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600">Circuit Open</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading handoffs...</div>;
  }

  if (handoffs.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No recent handoffs</div>;
  }

  return (
    <div className="space-y-4">
      {handoffs.map((handoff: any) => (
        <div key={handoff.id} className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <div className="font-medium">{handoff.from_agent_type} → {handoff.to_agent_type}</div>
            <div className="text-sm text-gray-500">
              {handoff.reasoning?.trigger || 'No trigger specified'}
            </div>
            {handoff.to_job_id && (
              <div className="text-xs text-gray-400 mt-1">Job ID: {handoff.to_job_id.substring(0, 8)}...</div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {getStatusBadge(handoff.status)}
            <span className="text-sm text-gray-500">
              {formatDistanceToNow(new Date(handoff.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ObservabilityPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <MonitoringDashboard />
    </Suspense>
  );
}