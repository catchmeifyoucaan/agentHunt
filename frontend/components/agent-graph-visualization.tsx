'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { workflowTracingApi } from '@/lib/api';
import { WorkflowChain, JobTraceNode } from '@/types/workflow';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';

interface AgentGraphProps {
  programId?: string;
  jobId?: string;
}

const AgentGraphVisualization: React.FC<AgentGraphProps> = ({ programId, jobId: initialJobId }) => {
  const [workflows, setWorkflows] = useState<WorkflowChain[]>([]);
  const [selectedChain, setSelectedChain] = useState<WorkflowChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(initialJobId || '');
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (programId) {
      fetchWorkflows();
    }
  }, [programId]);

  useEffect(() => {
    if (initialJobId) {
      fetchChain(initialJobId);
    }
  }, [initialJobId]);

  const fetchWorkflows = async () => {
    if (!programId) return;
    
    setLoading(true);
    try {
      const response = await workflowTracingApi.getWorkflows(programId);
      setWorkflows(response.data.workflows);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch workflows',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchChain = async (id: string) => {
    setLoading(true);
    try {
      const response = await workflowTracingApi.getChain(id);
      setSelectedChain(response.data);
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

  const handleVisualize = () => {
    if (jobId) {
      fetchChain(jobId);
    }
  };

  const renderNode = (node: JobTraceNode, x: number, y: number, depth: number) => {
    const statusColor = 
      node.status === 'completed' ? 'bg-green-500' :
      node.status === 'failed' ? 'bg-red-500' :
      node.status === 'active' ? 'bg-blue-500' :
      node.status === 'pending' ? 'bg-yellow-500' : 'bg-gray-500';

    return (
      <motion.div
        key={node.id}
        className={`absolute w-32 p-3 rounded-lg border shadow-md flex flex-col items-center ${
          node.id === selectedChain?.rootJobId ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'
        }`}
        style={{ left: x, top: y }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="text-xs font-semibold truncate w-full text-center">{node.type}</div>
        <div className="text-xs text-gray-600 truncate w-full text-center">{node.id.substring(0, 8)}...</div>
        <Badge className={`mt-1 ${statusColor} text-white text-xs`}>
          {node.status}
        </Badge>
        <div className="text-xs text-gray-500 mt-1">
          {new Date(node.createdAt as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </motion.div>
    );
  };

  const renderConnections = (node: JobTraceNode, parentX: number, parentY: number, depth: number) => {
    if (!node.children || node.children.length === 0) return null;
    
    const connections: (JSX.Element | null)[] = [];
    const childOffset = 120; // Horizontal spacing between children
    const startY = parentY + 80; // Position below parent
    
    node.children.forEach((child, idx) => {
      const childX = parentX - ((node.children.length - 1) * childOffset) / 2 + (idx * childOffset);
      const childY = startY + (depth * 100);
      
      connections.push(
        <svg key={`line-${child.id}`} className="absolute top-0 left-0 w-full h-full pointer-events-none">
          <line 
            x1={parentX + 64} y1={parentY + 40} 
            x2={childX + 64} y2={childY + 20} 
            stroke="#94a3b8" 
            strokeWidth="2"
            strokeDasharray="5,5"
          />
        </svg>
      );
      
      const childConnections = renderConnections(child, childX, childY, depth + 1);
      if (childConnections) {
        connections.push(...childConnections);
      }
    });
    
    return connections;
  };

  const renderGraph = () => {
    if (!selectedChain) return null;
    
    // Calculate positions for a tree layout
    const positions: Map<string, { x: number; y: number; depth: number }> = new Map();
    const calculatePositions = (node: JobTraceNode, x: number, y: number, depth: number) => {
      positions.set(node.id, { x, y, depth });
      
      if (node.children && node.children.length > 0) {
        const childOffset = 120;
        const startX = x - ((node.children.length - 1) * childOffset) / 2;
        
        node.children.forEach((child, idx) => {
          calculatePositions(child, startX + (idx * childOffset), y + 100, depth + 1);
        });
      }
    };
    
    calculatePositions(selectedChain.chain, 300, 50, 0);
    
    return (
      <div className="relative w-full h-[600px] border rounded-lg bg-gray-50 overflow-auto">
        {Array.from(positions.entries()).map(([nodeId, pos]) => {
          // Find the actual node object
          const findNode = (current: JobTraceNode): JobTraceNode | null => {
            if (current.id === nodeId) return current;
            
            for (const child of current.children) {
              const found = findNode(child);
              if (found) return found;
            }
            
            return null;
          };
          
          const node = findNode(selectedChain.chain);
          if (!node) return null;
          
          return renderNode(node, pos.x, pos.y, pos.depth);
        })}
        
        {/* Render connections between nodes */}
        {renderConnections(selectedChain.chain, 300, 50, 0)}
      </div>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span>Agent Workflow Visualization</span>
          <div className="flex gap-2">
            <Input
              placeholder="Job ID"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-64"
            />
            <Button onClick={handleVisualize} disabled={loading}>
              {loading ? 'Loading...' : 'Visualize'}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {selectedChain ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center p-2 bg-gray-100 rounded">
              <div className="text-sm">
                <span className="font-medium">Root Job:</span> {selectedChain.rootJobId.substring(0, 8)}...
              </div>
              <div className="text-sm">
                <span className="font-medium">Total Jobs:</span> {selectedChain.totalJobs} | 
                <span className="font-medium ml-2">Completed:</span> {selectedChain.completedJobs} | 
                <span className="font-medium ml-2">Status:</span> 
                <Badge variant={selectedChain.status === 'completed' ? 'default' : 
                              selectedChain.status === 'failed' ? 'destructive' : 
                              selectedChain.status === 'running' ? 'secondary' : 'outline'}
                      className="ml-1">
                  {selectedChain.status}
                </Badge>
              </div>
            </div>
            
            {renderGraph()}
            
            <div className="flex gap-4 mt-4">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-xs">Completed</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                <span className="text-xs">Active</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                <span className="text-xs">Pending</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                <span className="text-xs">Failed</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>Enter a job ID to visualize the workflow chain</p>
            {workflows.length > 0 && (
              <div className="mt-4">
                <h3 className="font-medium mb-2">Recent Workflows:</h3>
                <div className="flex flex-wrap gap-2 justify-center">
                  {workflows.slice(0, 5).map((workflow) => (
                    <Button
                      key={workflow.rootJobId}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setJobId(workflow.rootJobId);
                        fetchChain(workflow.rootJobId);
                      }}
                    >
                      {workflow.rootJobId.substring(0, 8)}... ({workflow.totalJobs})
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AgentGraphVisualization;