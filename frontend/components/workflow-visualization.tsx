'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
  Controls,
  Background,
  Node,
  Edge,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { WorkflowChain, JobTraceNode } from '@/types/workflow';
import { useEventStream } from '@/hooks/useWebSocket';

interface WorkflowVisualizationProps {
  initialChain?: WorkflowChain;
  programId?: string;
}

const statusColors: { [key: string]: string } = {
  completed: '#22c55e', // green-500
  failed: '#ef4444', // red-500
  active: '#3b82f6', // blue-500
  pending: '#eab308', // yellow-500
  unknown: '#6b7280', // gray-500
};

const CustomNode = ({ data }: { data: any }) => (
  <div
    style={{
      background: '#fff',
      border: `2px solid ${statusColors[data.status] || statusColors.unknown}`,
      borderRadius: '8px',
      padding: '10px 15px',
      width: 200,
    }}
  >
    <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{data.label}</div>
    <div style={{ fontSize: '0.8em', color: '#555' }}>ID: {data.id}</div>
    <Badge
      style={{
        backgroundColor: statusColors[data.status] || statusColors.unknown,
        color: 'white',
        position: 'absolute',
        top: -10,
        right: -10,
      }}
    >
      {data.status}
    </Badge>
  </div>
);

const nodeTypes = {
  custom: CustomNode,
};

const WorkflowVisualization: React.FC<WorkflowVisualizationProps> = ({
  initialChain,
  programId,
}) => {
  const [chain, setChain] = useState<WorkflowChain | null>(initialChain || null);
  const [jobId, setJobId] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const { events } = useEventStream({ jobId: chain?.rootJobId });

  useEffect(() => {
    if (initialChain) {
      setChain(initialChain);
    }
  }, [initialChain]);

  useEffect(() => {
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      if (lastEvent.type === 'job-status-update' && chain) {
        // A real implementation would update the chain state more intelligently
        // For now, we just refetch the whole chain
        fetchChain(chain.rootJobId);
      }
    }
  }, [events]);

  const fetchChain = async (id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/workflow-tracing/chains/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch workflow chain');
      }
      const data = await response.json();
      setChain(data);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch workflow chain',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFetchClick = () => {
    if (!jobId) {
      toast({
        title: 'Error',
        description: 'Please enter a job ID',
        variant: 'destructive',
      });
      return;
    }
    fetchChain(jobId);
  };

  const { nodes, edges } = useMemo(() => {
    if (!chain) return { nodes: [], edges: [] };

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const visited = new Set();

    function traverse(node: JobTraceNode, parentPosition = { x: 0, y: 0 }, level = 0) {
      if (visited.has(node.id)) return;
      visited.add(node.id);

      const position = {
        x: parentPosition.x + (Math.random() - 0.5) * 300,
        y: level * 150,
      };

      newNodes.push({
        id: node.id,
        type: 'custom',
        data: { label: node.type, status: node.status, id: node.id },
        position,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });

      if (node.children) {
        node.children.forEach((child, index) => {
          newEdges.push({
            id: `e-${node.id}-${child.id}`,
            source: node.id,
            target: child.id,
            animated: child.status === 'active',
          });
          traverse(child, position, level + 1);
        });
      }
    }

    traverse(chain.chain);
    return { nodes: newNodes, edges: newEdges };
  }, [chain]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workflow Chain Visualization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Enter Job ID to visualize"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleFetchClick()}
            />
            <Button onClick={handleFetchClick} disabled={loading}>
              {loading ? 'Loading...' : 'Visualize'}
            </Button>
          </div>

          {chain && (
            <div className="mt-4">
              <div className="mb-4 flex justify-between items-center">
                <h3 className="text-lg font-medium">Execution Chain</h3>
                <div className="flex gap-4 text-sm">
                  <span>Total Jobs: {chain.totalJobs}</span>
                  <span>Completed: {chain.completedJobs}</span>
                  <span>
                    Status:{' '}
                    <Badge
                      variant={
                        chain.status === 'completed'
                          ? 'default'
                          : chain.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {chain.status}
                    </Badge>
                  </span>
                </div>
              </div>

              <div
                className="border rounded-lg bg-gray-50"
                style={{ height: 600 }}
              >
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                >
                  <Controls />
                  <Background />
                </ReactFlow>
              </div>
            </div>
          )}

          {!chain && !loading && (
            <div className="text-center py-8 text-gray-500">
              <p>Enter a job ID above to visualize its workflow chain</p>
              {programId && (
                <p className="text-sm mt-2">
                  Or view active workflows for program: {programId}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WorkflowVisualization;