'use client';

import { useState, useEffect } from 'react';
import { useEventStream } from '@/hooks/useWebSocket';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Terminal, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '../../components/ui/use-toast';

interface ManagerCommandResult {
  id: string;
  command: string;
  programId?: string;
  userId: string;
  parsedIntent: {
    action: string;
    entities: any;
    confidence: number;
  };
  response: string;
  executedActions: Array<{
    type: string;
    params: any;
    result?: any;
    error?: string;
  }>;
  timestamp: Date;
}

interface ApprovalRequest {
  id: string;
  type: string;
  requested_by: string;
  action: string;
  reason: string;
  risk_level: string;
  context: any;
  created_at: string;
}

export default function ManagerAgentPage() {
  const [command, setCommand] = useState('');
  const [results, setResults] = useState<ManagerCommandResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const { toast } = useToast();

  const fetchPendingApprovals = async () => {
    try {
      const response = await fetch('/api/v1/manager/approvals/pending');
      if (!response.ok) {
        throw new Error('Failed to fetch pending approvals');
      }
      const data = await response.json();
      setPendingApprovals(data.approvals);
    } catch (err: any) {
      console.error('Error fetching pending approvals:', err);
      // setError(err.message); // Don't show toast for background fetch errors
    }
  };

  // Use WebSocket for real-time updates
  const { events } = useEventStream();
  
  useEffect(() => {
    fetchPendingApprovals();
    // No more polling - WebSocket will update in real-time
  }, []);
  
  // Refetch on WebSocket events
  useEffect(() => {
    const approvalEvent = events.find(e => 
      e.type === 'human_action_request' || 
      e.type === 'approval:update'
    );
    if (approvalEvent) {
      fetchPendingApprovals();
    }
  }, [events]);

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/manager/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command: command, user_id: 'frontend-user' }), // Add program_id if available
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute command');
      }

      const result: ManagerCommandResult = await response.json();
      setResults((prev) => [result, ...prev]);
      setCommand('');
      toast({
        title: 'Command Executed',
        description: result.response,
      });
      fetchPendingApprovals(); // Refetch approvals after command submission
    } catch (err: any) {
      setError(err.message || 'An unknown error occurred.');
      toast({
        title: 'Command Error',
        description: err.message || 'An unknown error occurred.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      const response = await fetch(`/api/v1/manager/approvals/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: 'frontend-user' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve request');
      }

      toast({
        title: 'Approval Granted',
        description: `Request ${requestId} has been approved.`,
      });
      fetchPendingApprovals();
    } catch (err: any) {
      toast({
        title: 'Approval Error',
        description: err.message || 'An unknown error occurred.',
        variant: 'destructive',
      });
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      const response = await fetch(`/api/v1/manager/approvals/${requestId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: 'frontend-user', reason: 'Rejected by user' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject request');
      }

      toast({
        title: 'Approval Rejected',
        description: `Request ${requestId} has been rejected.`,
      });
      fetchPendingApprovals();
    } catch (err: any) {
      toast({
        title: 'Rejection Error',
        description: err.message || 'An unknown error occurred.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex flex-col h-full p-4">
      <Card className="flex-grow flex flex-col mb-4">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold flex items-center">
            <Terminal className="w-5 h-5 mr-2" /> Manager Agent Console
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-grow flex flex-col">
          <ScrollArea className="flex-grow border rounded-md p-4 mb-4 bg-gray-50 dark:bg-gray-900">
            {results.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">No commands executed yet.</p>
            )}
            {results.map((res) => (
              <div key={res.id} className="mb-4 p-3 border rounded-md bg-white dark:bg-gray-800 shadow-sm">
                <p className="font-mono text-sm text-blue-600 dark:text-blue-400">
                  &gt; {res.command}
                </p>
                <p className="text-gray-800 dark:text-gray-200 mt-1">{res.response}</p>
                {res.executedActions.map((action, idx) => (
                  <div key={idx} className="ml-4 mt-2 text-sm">
                    <p className="text-gray-600 dark:text-gray-400">
                      Action: <span className="font-mono">{action.type}</span>
                    </p>
                    {action.result && (
                      <p className="text-green-600 dark:text-green-400">
                        Result: {JSON.stringify(action.result)}
                      </p>
                    )}
                    {action.error && (
                      <p className="text-red-600 dark:text-red-400">
                        Error: {action.error}
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">
                  {new Date(res.timestamp).toLocaleString()}
                </p>
              </div>
            ))}
          </ScrollArea>
          <form onSubmit={handleCommandSubmit} className="flex gap-2">
            <Input
              type="text"
              placeholder="Enter command for Manager Agent (e.g., 'summarize findings for program X')"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={loading}
              className="flex-grow"
            />
            <Button type="submit" disabled={loading}>
              {loading ? 'Executing...' : 'Execute'}
            </Button>
          </form>
          {error && <p className="text-red-500 mt-2">{error}</p>}
        </CardContent>
      </Card>

      {/* Approval Workflow Section */}
      <Card className="flex-shrink-0">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center">
            <CheckCircle className="w-5 h-5 mr-2" /> Pending Approvals ({pendingApprovals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px] border rounded-md p-4 bg-gray-50 dark:bg-gray-900">
            {pendingApprovals.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">No pending approval requests.</p>
            )}
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="mb-4 p-3 border rounded-md bg-white dark:bg-gray-800 shadow-sm">
                <p className="font-semibold text-gray-800 dark:text-gray-200">
                  {approval.context?.parsedIntent?.action || approval.action}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                  Reason: {approval.reason}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Requested by: {approval.requested_by} | Risk: {approval.risk_level}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApprove(approval.id)}
                    disabled={loading}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleReject(approval.id)}
                    disabled={loading}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
