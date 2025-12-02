'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Download, FileText, Send, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { getSeverityColor } from '@/lib/utils';

export default function FindingDetailPage() {
  const params = useParams();
  const findingId = params?.id as string;
  const [showTemplate, setShowTemplate] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('hackerone');
  const [template, setTemplate] = useState('');

  const { data: findingData } = useQuery({
    queryKey: ['finding', findingId],
    queryFn: () => api.get(`/findings/${findingId}`),
  });

  const finding = findingData?.data?.finding;

  const handleDownloadPoC = async (format: 'markdown' | 'txt') => {
    try {
      const response = await api.get(`/exports/findings/${findingId}/poc`, {
        params: { format },
      });

      const { downloadUrl } = response.data;
      window.open(downloadUrl, '_blank');
      toast.success(`PoC downloaded as ${format.toUpperCase()}`);
    } catch (error: any) {
      toast.error('Failed to download PoC');
    }
  };

  const handleGenerateTemplate = async () => {
    try {
      const response = await api.get(`/submissions/findings/${findingId}/template`, {
        params: { platform: selectedPlatform },
      });

      setTemplate(response.data.template);
      setShowTemplate(true);
      toast.success('Template generated');
    } catch (error: any) {
      toast.error('Failed to generate template');
    }
  };

  const handleCopyTemplate = () => {
    navigator.clipboard.writeText(template);
    toast.success('Template copied to clipboard');
  };

  const handleRequestApproval = async () => {
    try {
      await api.post(`/submissions/findings/${findingId}/request-approval`, {
        userId: 'current-user',
        notes: 'Requesting approval for manual submission',
      });

      toast.success('Approval request submitted. Waiting for admin review.');
    } catch (error: any) {
      toast.error('Failed to request approval');
    }
  };

  if (!finding) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-xs font-medium px-2 py-1 rounded ${getSeverityColor(finding.severity)}`}>
                  {finding.severity.toUpperCase()}
                </span>
                <span className="text-xs text-muted-foreground">
                  Confidence: {Math.round(finding.confidence * 100)}%
                </span>
                {finding.cvss && (
                  <span className="text-xs text-muted-foreground">CVSS: {finding.cvss}</span>
                )}
              </div>
              <h1 className="text-2xl font-bold">{finding.title}</h1>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => handleDownloadPoC('markdown')}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download PoC (Markdown)
            </button>

            <button
              onClick={() => handleDownloadPoC('txt')}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80 transition-colors flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Download PoC (TXT)
            </button>

            <button
              onClick={handleGenerateTemplate}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm hover:bg-accent/80 transition-colors flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Generate Submission Template
            </button>

            <button
              onClick={handleRequestApproval}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Request Submission Approval
            </button>
          </div>
        </div>

        {/* Template Generator */}
        {showTemplate && (
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Manual Submission Template</h2>
              <div className="flex items-center gap-3">
                <select
                  value={selectedPlatform}
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                  className="px-3 py-2 bg-background border border-input rounded-md text-sm"
                >
                  <option value="hackerone">HackerOne</option>
                  <option value="bugcrowd">Bugcrowd</option>
                  <option value="intigriti">Intigriti</option>
                  <option value="yeswehack">YesWeHack</option>
                  <option value="generic">Generic</option>
                </select>
                <button
                  onClick={handleGenerateTemplate}
                  className="px-3 py-2 bg-secondary rounded-md text-sm hover:bg-secondary/80"
                >
                  Regenerate
                </button>
                <button
                  onClick={handleCopyTemplate}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
                >
                  Copy to Clipboard
                </button>
              </div>
            </div>

            <div className="bg-muted p-4 rounded-md font-mono text-sm whitespace-pre-wrap max-h-96 overflow-auto">
              {template}
            </div>

            <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Human-in-the-Loop:</strong> This template is for manual submission. Copy the content above and submit it to the platform. After submission, use the "Mark as Submitted" button below to update the status.
              </p>
            </div>
          </div>
        )}

        {/* Finding Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-3">Description</h2>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{finding.description}</ReactMarkdown>
              </div>
            </div>

            {/* PoC */}
            {finding.poc && finding.poc.steps && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-3">Proof of Concept</h2>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  {finding.poc.steps.map((step: string, i: number) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>

                {finding.poc.curl && (
                  <div className="mt-4">
                    <p className="text-sm font-medium mb-2">Request:</p>
                    <pre className="bg-muted p-3 rounded-md text-xs overflow-auto">
                      {finding.poc.curl}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Impact */}
            {finding.impact && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-3">Impact</h2>
                <p className="text-sm text-muted-foreground">{finding.impact}</p>
              </div>
            )}

            {/* Remediation */}
            {finding.remediation && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-3">Remediation</h2>
                <p className="text-sm text-muted-foreground">{finding.remediation}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm font-semibold mb-3">Status</h3>
              <select className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm">
                <option value={finding.status}>{finding.status}</option>
                <option value="triaged">Triaged</option>
                <option value="confirmed">Confirmed</option>
                <option value="submitted">Submitted</option>
                <option value="false_positive">False Positive</option>
              </select>
            </div>

            {/* Metadata */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm font-semibold mb-3">Details</h3>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Finding ID</dt>
                  <dd className="font-mono text-xs">{finding.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{new Date(finding.created_at).toLocaleString()}</dd>
                </div>
                {finding.cwe && finding.cwe.length > 0 && (
                  <div>
                    <dt className="text-muted-foreground">CWE</dt>
                    <dd>{finding.cwe.join(', ')}</dd>
                  </div>
                )}
                {finding.confirmations && (
                  <div>
                    <dt className="text-muted-foreground">Confirmations</dt>
                    <dd>
                      {finding.confirmations.filter((c: any) => c.result === 'pass').length} /{' '}
                      {finding.confirmations.length} passed
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
