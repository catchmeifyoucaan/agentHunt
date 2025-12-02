'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  ShieldAlert,
  ShieldOff,
  Loader2,
} from 'lucide-react';

interface ApprovalRequest {
  id: string;
  action: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: string;
  context: Record<string, any>;
  dangerLevel: 'safe' | 'elevated' | 'critical' | 'destructive';
}

interface ApprovalQueueProps {
  onApprove?: (requestId: string) => Promise<void>;
  onReject?: (requestId: string, reason: string) => Promise<void>;
}

export function ApprovalQueue({ onApprove, onReject }: ApprovalQueueProps) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
    // Poll every 10 seconds
    const interval = setInterval(fetchRequests, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchRequests = async () => {
    try {
      const response = await fetch('/api/approvals/pending');
      if (response.ok) {
        const data = await response.json();
        setRequests(data.requests || []);
      }
    } catch (err) {
      console.error('Failed to fetch approval requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessingId(requestId);
    setError(null);
    try {
      if (onApprove) {
        await onApprove(requestId);
      } else {
        const response = await fetch(`/api/approvals/${requestId}/approve`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error('Failed to approve request');
        }
      }
      await fetchRequests();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    setProcessingId(requestId);
    setError(null);
    try {
      const reason = prompt('Enter rejection reason:');
      if (!reason) {
        setProcessingId(null);
        return;
      }

      if (onReject) {
        await onReject(requestId, reason);
      } else {
        const response = await fetch(`/api/approvals/${requestId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        if (!response.ok) {
          throw new Error('Failed to reject request');
        }
      }
      await fetchRequests();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const getDangerIcon = (level: ApprovalRequest['dangerLevel']) => {
    switch (level) {
      case 'safe':
        return <Shield className="w-4 h-4 text-green-500" />;
      case 'elevated':
        return <Shield className="w-4 h-4 text-yellow-500" />;
      case 'critical':
        return <ShieldAlert className="w-4 h-4 text-orange-500" />;
      case 'destructive':
        return <ShieldOff className="w-4 h-4 text-red-500" />;
    }
  };

  const getDangerBadge = (level: ApprovalRequest['dangerLevel']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      safe: 'default',
      elevated: 'secondary',
      critical: 'destructive',
      destructive: 'destructive',
    };

    return (
      <Badge variant={variants[level]} className="flex items-center gap-1">
        {getDangerIcon(level)}
        {level.toUpperCase()}
      </Badge>
    );
  };

  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `${minutes}m remaining`;

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m remaining`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading approval requests...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" />
            Pending Approvals
          </CardTitle>
          <CardDescription>
            Critical operations requiring administrator approval
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
              <p>No pending approval requests</p>
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {request.action}
                        {getDangerBadge(request.dangerLevel)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Requested by {request.requestedBy}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getTimeRemaining(request.expiresAt)}
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="bg-muted/50 rounded p-3 text-sm">
                    {request.reason}
                  </div>

                  {/* Context */}
                  {request.context && Object.keys(request.context).length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View context details
                      </summary>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-40">
                        {JSON.stringify(request.context, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleApprove(request.id)}
                      disabled={processingId === request.id}
                      className="flex items-center gap-1"
                    >
                      {processingId === request.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReject(request.id)}
                      disabled={processingId === request.id}
                      className="flex items-center gap-1"
                    >
                      {processingId === request.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      Reject
                    </Button>
                    <div className="flex-1" />
                    <div className="text-xs text-muted-foreground">
                      {new Date(request.requestedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
