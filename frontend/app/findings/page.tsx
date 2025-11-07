'use client';

import { useQuery } from '@tanstack/react-query';
import { programsApi } from '@/lib/api';
import { AlertTriangle, Filter, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { formatRelativeTime, getSeverityColor } from '@/lib/utils';
import Link from 'next/link';

export default function FindingsPage() {
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const { data: findingsData } = useQuery({
    queryKey: ['findings', selectedProgram],
    queryFn: async () => {
      if (selectedProgram) {
        return programsApi.getFindings(selectedProgram, { limit: 100 });
      }
      return { data: { findings: [] }, status: 200, statusText: 'OK', headers: {}, config: {} as any };
    },
    enabled: !!selectedProgram,
  });

  const programs = programsData?.data?.programs || [];
  const allFindings = findingsData?.data?.findings || [];

  // Filter findings
  const findings = allFindings
    .filter((f: any) => !selectedSeverity || f.severity === selectedSeverity)
    .filter((f: any) => !selectedStatus || f.status === selectedStatus);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <div>
              <h1 className="text-2xl font-bold">Findings</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {findings.length} vulnerabilities discovered
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <select
            value={selectedProgram}
            onChange={(e) => setSelectedProgram(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select Program...</option>
            {programs.map((program: any) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>

          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="triaged">Triaged</option>
            <option value="confirmed">Confirmed</option>
            <option value="false_positive">False Positive</option>
            <option value="submitted">Submitted</option>
          </select>
        </div>
      </div>

      {/* Findings List */}
      <div className="flex-1 overflow-auto p-6">
        {!selectedProgram ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Filter className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Select a program to view findings</p>
            </div>
          </div>
        ) : findings.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No findings yet</p>
              <p className="text-sm mt-2">Run scans to discover vulnerabilities</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {findings.map((finding: any) => (
              <div
                key={finding.id}
                className="bg-card border border-border rounded-lg p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded ${getSeverityColor(
                          finding.severity
                        )}`}
                      >
                        {finding.severity.toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Confidence: {Math.round(finding.confidence * 100)}%
                      </span>
                      {finding.cvss && (
                        <span className="text-xs text-muted-foreground">
                          CVSS: {finding.cvss}
                        </span>
                      )}
                    </div>

                    <h3 className="text-lg font-semibold mb-2">{finding.title}</h3>

                    <p className="text-sm text-muted-foreground mb-3">
                      {finding.description.substring(0, 200)}...
                    </p>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{formatRelativeTime(finding.created_at)}</span>
                      {finding.cwe && finding.cwe.length > 0 && (
                        <span>CWE: {finding.cwe.join(', ')}</span>
                      )}
                      {finding.confirmations && finding.confirmations.length > 0 && (
                        <span>
                          ✓ {finding.confirmations.filter((c: any) => c.result === 'pass').length}/
                          {finding.confirmations.length} confirmations
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors flex items-center gap-2">
                      View Details
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <select className="px-4 py-2 bg-background border border-input rounded-md text-sm">
                      <option value={finding.status}>{finding.status}</option>
                      <option value="triaged">Mark as Triaged</option>
                      <option value="confirmed">Mark as Confirmed</option>
                      <option value="false_positive">Mark as False Positive</option>
                      <option value="submitted">Mark as Submitted</option>
                    </select>
                  </div>
                </div>

                {/* PoC Preview */}
                {finding.poc && finding.poc.steps && finding.poc.steps.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs font-medium mb-2">PoC Steps:</p>
                    <ol className="text-xs space-y-1 text-muted-foreground list-decimal list-inside">
                      {finding.poc.steps.slice(0, 3).map((step: string, i: number) => (
                        <li key={i}>{step}</li>
                      ))}
                      {finding.poc.steps.length > 3 && (
                        <li className="text-primary">
                          +{finding.poc.steps.length - 3} more steps...
                        </li>
                      )}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
