import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ArrowRight, CheckCircle, XCircle, AlertTriangle, Clock, Activity, Target, FileText, Brain } from 'lucide-react';

interface HandoffDetailsProps {
  handoff: any;
}

export const HandoffDetails: React.FC<HandoffDetailsProps> = ({ handoff }) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'accepted':
        return <Badge variant="secondary" className="bg-blue-500 text-white">In Progress</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Flow</span>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2 text-lg font-bold">
              <span className="text-blue-600">{handoff.from_agent_type}</span>
              <ArrowRight className="h-4 w-4" />
              <span className="text-purple-600">{handoff.to_agent_type}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Status</span>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(handoff.status)}
              <span className="text-sm text-muted-foreground">
                {new Date(handoff.created_at).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Jobs</span>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-1 text-sm">
              {handoff.to_job_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Job ID:</span>
                  <span className="font-mono">{handoff.to_job_id}</span>
                </div>
              )}
              {handoff.program_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Program:</span>
                  <span className="font-mono">{handoff.program_id}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Reasoning */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Decision Logic
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">Trigger</h4>
            <p className="text-sm bg-slate-50 dark:bg-slate-900 p-3 rounded-md">
              {handoff.reasoning?.trigger || 'No explicit trigger recorded'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium mb-2 text-muted-foreground">Decision Factors</h4>
              <ul className="space-y-1">
                {handoff.reasoning?.decisionFactors?.map((factor: string, i: number) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    <span>{factor}</span>
                  </li>
                )) || <li className="text-sm text-muted-foreground">No factors recorded</li>}
              </ul>
            </div>
            
            <div>
              <h4 className="text-sm font-medium mb-2 text-muted-foreground">Confidence Score</h4>
              <div className="flex items-center gap-2">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${(handoff.reasoning?.confidence || 0) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-bold">
                  {((handoff.reasoning?.confidence || 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Objectives & Contract */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5" />
              Objectives
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1 text-blue-600">Primary Objective</h4>
              <p className="text-sm">{handoff.objectives?.primary || 'Not specified'}</p>
            </div>
            
            {handoff.objectives?.secondary?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 text-muted-foreground">Secondary Objectives</h4>
                <ul className="space-y-1">
                  {handoff.objectives.secondary.map((obj: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                      <span>{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Output Contract
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-muted-foreground">Format</span>
              <Badge variant="outline">{handoff.outputContract?.format || 'JSON'}</Badge>
            </div>

            {handoff.outputContract?.requiredFields?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 text-muted-foreground">Required Fields</h4>
                <div className="flex flex-wrap gap-2">
                  {handoff.outputContract.requiredFields.map((field: string, i: number) => (
                    <Badge key={i} variant="secondary" className="font-mono text-xs">
                      {field}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm font-medium text-muted-foreground">Triggers Next Handoff</span>
              {handoff.outputContract?.shouldTriggerNextHandoff ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-300" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Raw Data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Payload Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px] w-full rounded-md border bg-slate-50 dark:bg-slate-900 p-4">
            <pre className="text-xs font-mono">
              {JSON.stringify(handoff.parentResult || {}, null, 2)}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
