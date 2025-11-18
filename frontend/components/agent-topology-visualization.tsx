'use client';

import React, { useState, useEffect } from 'react';
import { useEventStream } from '@/hooks/useWebSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { 
  Bot, 
  ArrowRight, 
  Activity, 
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Play,
  Pause
} from 'lucide-react';

interface AgentNode {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'idle' | 'error' | 'offline';
  jobsProcessed: number;
  lastHeartbeat: Date;
  connections: string[]; // IDs of connected agents
  capacity: number;
  currentLoad: number;
  version: string;
}

interface AgentConnection {
  id: string;
  from: string; // agent ID
  to: string; // agent ID
  type: 'handoff' | 'message' | 'data' | 'coordination';
  active: boolean;
}

interface AgentTopology {
  agents: AgentNode[];
  connections: AgentConnection[];
  lastUpdated: Date;
}

const AgentTopologyVisualization: React.FC = () => {
  const [topology, setTopology] = useState<AgentTopology | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Use WebSocket for real-time updates
  const { events } = useEventStream();
  
  useEffect(() => {
    // Fetch real data on mount
    fetchTopologyData();
    // No more polling - WebSocket will update in real-time
  }, []);
  
  // Refetch on WebSocket events
  useEffect(() => {
    const topologyEvent = events.find(e => 
      e.type === 'agent:health' || 
      e.type === 'program:jobs' ||
      e.type === 'handoff:status'
    );
    if (topologyEvent) {
      fetchTopologyData();
    }
  }, [events]);

  // Removed initializeMockData - now fetching real data from API

  const fetchTopologyData = async () => {
    setLoading(true);
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${API_URL}/api/v1/topology`);

      if (!response.ok) {
        throw new Error(`Failed to fetch topology: ${response.statusText}`);
      }

      const data = await response.json();

      // Map API data to component state
      setTopology({
        agents: data.agents.map((agent: any) => ({
          ...agent,
          lastHeartbeat: new Date(agent.lastHeartbeat),
        })),
        connections: data.connections,
        lastUpdated: new Date(data.lastUpdated),
      });

      console.log('✅ Fetched real agent topology:', data.agents.length, 'agents');
    } catch (error) {
      console.error('Failed to fetch topology:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch agent topology. Using cached data.',
        variant: 'destructive',
      });

      // Fall back to cached data or keep existing topology
    } finally {
      setLoading(false);
    }
  };

  const getAgentIcon = (type: string) => {
    switch (type) {
      case 'manager':
        return <Bot className="w-5 h-5 text-purple-500" />;
      case 'planner':
        return <Activity className="w-5 h-5 text-blue-500" />;
      case 'executor':
        return <Play className="w-5 h-5 text-green-500" />;
      case 'researcher':
        return <Activity className="w-5 h-5 text-yellow-500" />;
      case 'discovery':
        return <Activity className="w-5 h-5 text-indigo-500" />;
      case 'xss':
      case 'sqli':
      case 'ssrf':
      case 'webvulns':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'confirm':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'triage':
      case 'intelligent-triage':
        return <Activity className="w-5 h-5 text-orange-500" />;
      default:
        return <Bot className="w-5 h-5 text-gray-500" />;
    }
  };

  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'idle':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'error':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'offline':
        return 'bg-gray-100 text-gray-800 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getConnectionColor = (type: string, active: boolean) => {
    if (!active) return '#9ca3af'; // gray for inactive
    
    switch (type) {
      case 'handoff':
        return '#60a5fa'; // blue for handoffs
      case 'message':
        return '#34d399'; // green for messages
      case 'data':
        return '#fbbf24'; // yellow for data
      default:
        return '#a78bfa'; // purple for others
    }
  };

  const renderTopology = () => {
    if (!topology) return null;

    // Simplified visualization - in a real implementation, we would use a library like D3 or Vis.js
    return (
      <div className="relative w-full h-[600px] border rounded-lg bg-gray-50 overflow-auto">
        {/* Render agent nodes */}
        <div className="relative w-full h-full">
          {topology.agents.map((agent, index) => {
            // Position agents in a circular layout
            const centerX = 300;
            const centerY = 300;
            const radius = 200;
            const angle = (index * (2 * Math.PI)) / topology.agents.length;
            const x = centerX + radius * Math.cos(angle) - 50; // Center in 100x100 box
            const y = centerY + radius * Math.sin(angle) - 25; // Center in 50x50 box
            
            return (
              <motion.div
                key={agent.id}
                className={`absolute w-40 p-3 rounded-lg border shadow-md cursor-pointer ${
                  selectedAgent?.id === agent.id 
                    ? 'ring-2 ring-blue-500 bg-blue-50' 
                    : 'bg-white'
                }`}
                style={{ left: x, top: y }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.1 }}
                onClick={() => setSelectedAgent(agent)}
              >
                <div className="flex items-center gap-2">
                  {getAgentIcon(agent.type)}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{agent.name}</div>
                    <div className="text-xs text-gray-500 truncate">{agent.id}</div>
                  </div>
                </div>
                
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge className={getAgentStatusColor(agent.status)}>
                    {agent.status}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {agent.currentLoad.toFixed(0)}% Load
                  </Badge>
                </div>
                
                <div className="mt-2 text-xs text-gray-600">
                  <div>Jobs: {agent.jobsProcessed}</div>
                  <div>Ver: {agent.version}</div>
                </div>
              </motion.div>
            );
          })}
          
          {/* Render connections as SVG lines */}
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
            {topology.connections.map(connection => {
              const fromAgent = topology.agents.find(a => a.id === connection.from);
              const toAgent = topology.agents.find(a => a.id === connection.to);
              
              if (!fromAgent || !toAgent) return null;
              
              // Calculate positions based on circular layout
              const indexFrom = topology.agents.findIndex(a => a.id === fromAgent.id);
              const indexTo = topology.agents.findIndex(a => a.id === toAgent.id);
              
              const centerX = 300;
              const centerY = 300;
              const radius = 200;
              const angleFrom = (indexFrom * (2 * Math.PI)) / topology.agents.length;
              const angleTo = (indexTo * (2 * Math.PI)) / topology.agents.length;
              
              const fromX = centerX + radius * Math.cos(angleFrom);
              const fromY = centerY + radius * Math.sin(angleFrom);
              const toX = centerX + radius * Math.cos(angleTo);
              const toY = centerY + radius * Math.sin(angleTo);
              
              return (
                <line
                  key={connection.id}
                  x1={fromX}
                  y1={fromY}
                  x2={toX}
                  y2={toY}
                  stroke={getConnectionColor(connection.type, connection.active)}
                  strokeWidth={connection.active ? 2 : 1}
                  strokeDasharray={connection.active ? "5,5" : "2,2"}
                  opacity={connection.active ? 0.7 : 0.3}
                />
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Agent Topology Visualization</CardTitle>
          <div className="flex gap-2">
            <Button 
              onClick={fetchTopologyData} 
              disabled={loading}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Activity className="w-4 h-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4" />
                  Refresh
                </>
              )}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Visual representation of agent connections and communication patterns
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {renderTopology()}
          
          <div className="flex justify-between items-center p-2 bg-gray-100 rounded">
            <div className="flex gap-4">
              <div className="flex items-center">
                <div className="w-3 h-0.5 bg-blue-500 mr-2"></div>
                <span className="text-xs">Handoff</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-0.5 bg-green-500 mr-2"></div>
                <span className="text-xs">Message</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-0.5 bg-gray-500 mr-2"></div>
                <span className="text-xs">Inactive</span>
              </div>
            </div>
            <div className="text-sm text-gray-500">
              {topology?.agents.length || 0} agents, {topology?.connections.length || 0} connections
            </div>
          </div>
          
          {selectedAgent && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  {getAgentIcon(selectedAgent.type)}
                  {selectedAgent.name} Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-gray-500">ID</div>
                    <div className="font-mono text-sm">{selectedAgent.id}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Type</div>
                    <div className="text-sm capitalize">{selectedAgent.type}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Status</div>
                    <Badge className={getAgentStatusColor(selectedAgent.status)}>
                      {selectedAgent.status}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Load</div>
                    <div className="text-sm">{selectedAgent.currentLoad.toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Jobs Processed</div>
                    <div className="text-sm">{selectedAgent.jobsProcessed}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Version</div>
                    <div className="text-sm">{selectedAgent.version}</div>
                  </div>
                </div>
                
                <div className="mt-4">
                  <div className="text-sm font-medium mb-2">Connected to:</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedAgent.connections.map(connId => {
                      const connectedAgent = topology?.agents.find(a => a.id === connId);
                      return connectedAgent ? (
                        <Badge key={connId} variant="outline" className="text-xs">
                          {connectedAgent.name}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AgentTopologyVisualization;