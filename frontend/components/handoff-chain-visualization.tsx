'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
  Controls,
  Background,
  Node,
  Edge,
  Position,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useEventStream } from '@/hooks/useWebSocket';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2, 
  ArrowRight,
  GitBranch,
  RefreshCw,
  ZoomIn,
  ZoomOut
} from 'lucide-react';

interface HandoffNode {
  id: string;
  from_agent_type: string;
  to_agent_type: string;
  status: 'pending' | 'accepted' | 'completed' | 'failed' | 'rejected' | 'circuit_breaker_open';
  created_at: string;
  completed_at?: string;
  reasoning?: {
    trigger: string;
    confidence: number;
  };
  parentResult?: any;
}

interface HandoffChain {
  handoffs: HandoffNode[];
  rootJobId?: string;
  programId?: string;
}

const statusColors: { [key: string]: string } = {
  completed: '#22c55e', // green-500
  failed: '#ef4444', // red-500
  accepted: '#3b82f6', // blue-500
  pending: '#eab308', // yellow-500
  rejected: '#f97316', // orange-500
  circuit_breaker_open: '#dc2626', // red-600
  unknown: '#6b7280', // gray-500
};

const CustomNode = ({ data }: { data: any }) => {
  const statusColor = statusColors[data.status] || statusColors.unknown;
  
  return (
    <div
      style={{
        background: '#fff',
        border: `3px solid ${statusColor}`,
        borderRadius: '12px',
        padding: '12px 16px',
        minWidth: 180,
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <div
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: statusColor,
          }}
        />
        <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{data.fromAgent}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0' }}>
        <ArrowRight size={16} color="#6b7280" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: statusColor,
          }}
        />
        <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{data.toAgent}</div>
      </div>
      <Badge
        style={{
          backgroundColor: statusColor,
          color: 'white',
          marginTop: '8px',
          fontSize: '10px',
          padding: '2px 8px',
        }}
      >
        {data.status}
      </Badge>
      {data.confidence && (
        <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px' }}>
          Confidence: {Math.round(data.confidence * 100)}%
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

interface HandoffChainVisualizationProps {
  programId?: string;
  rootJobId?: string;
  initialHandoffs?: HandoffNode[];
}

const HandoffChainVisualization: React.FC<HandoffChainVisualizationProps> = ({
  programId,
  rootJobId,
  initialHandoffs,
}) => {
  const [handoffs, setHandoffs] = useState<HandoffNode[]>(initialHandoffs || []);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { events } = useEventStream({ programId, handoffId: undefined });

  // Fetch handoff chain data
  const fetchHandoffChain = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (programId) params.append('programId', programId);
      if (rootJobId) params.append('rootJobId', rootJobId);
      
      const response = await fetch(`/api/v1/dashboard/handoff-chain?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch handoff chain');
      }
      const data = await response.json();
      setHandoffs(data.handoffs || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch handoff chain',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [programId, rootJobId, toast]);

  useEffect(() => {
    if (initialHandoffs) {
      setHandoffs(initialHandoffs);
    } else {
      fetchHandoffChain();
    }
  }, [initialHandoffs, fetchHandoffChain]);

  // Update on WebSocket events
  useEffect(() => {
    const handoffEvent = events.find(e => e.type === 'handoff:status' || e.type === 'program:handoffs');
    if (handoffEvent) {
      fetchHandoffChain();
    }
  }, [events, fetchHandoffChain]);

  // Build ReactFlow nodes and edges from handoff chain
  const { nodes, edges } = useMemo(() => {
    if (handoffs.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Create a map of agent types to their positions
    const agentPositions = new Map<string, { x: number; y: number }>();
    const agentCounts = new Map<string, number>();
    
    // Count occurrences of each agent type
    handoffs.forEach(handoff => {
      agentCounts.set(handoff.from_agent_type, (agentCounts.get(handoff.from_agent_type) || 0) + 1);
      agentCounts.set(handoff.to_agent_type, (agentCounts.get(handoff.to_agent_type) || 0) + 1);
    });

    // Create nodes for each unique handoff
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeMap = new Map<string, Node>();

    handoffs.forEach((handoff, index) => {
      const nodeId = `handoff-${handoff.id}`;
      const fromAgent = handoff.from_agent_type;
      const toAgent = handoff.to_agent_type;

      // Calculate position based on handoff sequence
      const level = Math.floor(index / 3); // Group by 3 per level
      const positionInLevel = index % 3;
      const x = 250 + (positionInLevel * 300);
      const y = 100 + (level * 200);

      if (!nodeMap.has(nodeId)) {
        const node: Node = {
          id: nodeId,
          type: 'custom',
          position: { x, y },
          data: {
            fromAgent,
            toAgent,
            status: handoff.status,
            confidence: handoff.reasoning?.confidence,
            handoffId: handoff.id,
            label: `${fromAgent} → ${toAgent}`,
          },
        };
        nodes.push(node);
        nodeMap.set(nodeId, node);

        // Create edge from previous handoff if this is a chain
        if (index > 0) {
          const prevHandoff = handoffs[index - 1];
          const prevNodeId = `handoff-${prevHandoff.id}`;
          
          // Only create edge if the previous handoff's target matches this handoff's source
          if (prevHandoff.to_agent_type === fromAgent) {
            edges.push({
              id: `edge-${prevHandoff.id}-${handoff.id}`,
              source: prevNodeId,
              target: nodeId,
              type: 'smoothstep',
              animated: handoff.status === 'accepted' || handoff.status === 'pending',
              markerEnd: {
                type: MarkerType.ArrowClosed,
              },
              style: {
                stroke: statusColors[handoff.status] || statusColors.unknown,
                strokeWidth: 2,
              },
            });
          }
        }
      }
    });

    return { nodes, edges };
  }, [handoffs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'rejected':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'accepted':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Handoff Chain Visualization
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHandoffChain}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && handoffs.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : handoffs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <GitBranch className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No handoffs found</p>
            <p className="text-sm mt-2">
              Handoffs will appear here when agents coordinate work
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stats Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-sm text-muted-foreground">Total</div>
                <div className="text-2xl font-bold">{handoffs.length}</div>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-sm text-muted-foreground">Completed</div>
                <div className="text-2xl font-bold text-green-600">
                  {handoffs.filter(h => h.status === 'completed').length}
                </div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-sm text-muted-foreground">Pending</div>
                <div className="text-2xl font-bold text-yellow-600">
                  {handoffs.filter(h => h.status === 'pending').length}
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-sm text-muted-foreground">In Progress</div>
                <div className="text-2xl font-bold text-blue-600">
                  {handoffs.filter(h => h.status === 'accepted').length}
                </div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-sm text-muted-foreground">Failed</div>
                <div className="text-2xl font-bold text-red-600">
                  {handoffs.filter(h => h.status === 'failed' || h.status === 'rejected').length}
                </div>
              </div>
            </div>

            {/* ReactFlow Visualization */}
            <div style={{ width: '100%', height: '600px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-left"
              >
                <Background />
                <Controls />
              </ReactFlow>
            </div>

            {/* Handoff List */}
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Handoff Details</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {handoffs.map((handoff) => (
                  <div
                    key={handoff.id}
                    className="p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(handoff.status)}
                        <div>
                          <div className="font-medium">
                            {handoff.from_agent_type} → {handoff.to_agent_type}
                          </div>
                          {handoff.reasoning?.trigger && (
                            <div className="text-sm text-muted-foreground mt-1">
                              {handoff.reasoning.trigger}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            handoff.status === 'completed' ? 'default' :
                            handoff.status === 'failed' || handoff.status === 'rejected' ? 'destructive' :
                            'secondary'
                          }
                        >
                          {handoff.status}
                        </Badge>
                        {handoff.reasoning?.confidence && (
                          <span className="text-xs text-muted-foreground">
                            {Math.round(handoff.reasoning.confidence * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HandoffChainVisualization;
