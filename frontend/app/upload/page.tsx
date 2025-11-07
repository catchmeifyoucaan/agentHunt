'use client';

import { useState } from 'react';
import { AssetDropzone } from '@/components/AssetDropzone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Activity, CheckCircle, Clock, Loader2 } from 'lucide-react';

export default function UploadPage() {
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [activeJobs, setActiveJobs] = useState<any[]>([]);

  const handleOrchestrationStarted = (result: any) => {
    setUploadResult(result);
    if (result.orchestration?.jobs) {
      setActiveJobs(result.orchestration.jobs);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Upload Scope & Start Reconnaissance</h1>
          <p className="text-muted-foreground">
            Upload domains, subdomains, or HackerOne scope files to automatically start reconnaissance
          </p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload Assets</CardTitle>
              <CardDescription>
                Drop files or folders containing domains, subdomains, IPs, or URLs.
                Supports txt, csv, and json formats including HackerOne scope exports.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AssetDropzone
                programName={`Upload-${Date.now()}`}
                autoOrchestrate={true}
                onOrchestrationStarted={handleOrchestrationStarted}
              />
            </CardContent>
          </Card>

          {uploadResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Reconnaissance Pipeline
                </CardTitle>
                <CardDescription>
                  Your reconnaissance jobs are running in the background
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="summary">
                  <TabsList>
                    <TabsTrigger value="summary">Summary</TabsTrigger>
                    <TabsTrigger value="jobs">Jobs ({activeJobs.length})</TabsTrigger>
                    <TabsTrigger value="scope">Parsed Scope</TabsTrigger>
                  </TabsList>

                  <TabsContent value="summary" className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Program ID</p>
                        <p className="text-lg font-mono text-blue-600 truncate">
                          {uploadResult.programId?.slice(0, 8)}...
                        </p>
                      </div>
                      <div className="bg-green-50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Jobs Created</p>
                        <p className="text-2xl font-bold text-green-600">
                          {uploadResult.orchestration?.jobs?.length || 0}
                        </p>
                      </div>
                      <div className="bg-purple-50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Total Assets</p>
                        <p className="text-2xl font-bold text-purple-600">
                          {(uploadResult.parsedScope?.domains || 0) +
                            (uploadResult.parsedScope?.subdomains || 0) +
                            (uploadResult.parsedScope?.ips || 0) +
                            (uploadResult.parsedScope?.urls || 0)}
                        </p>
                      </div>
                      <div className="bg-orange-50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Est. Duration</p>
                        <p className="text-2xl font-bold text-orange-600">
                          {Math.round((uploadResult.orchestration?.estimatedDuration || 0) / 60)}m
                        </p>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-medium text-blue-900 mb-2">What happens next?</h4>
                      <ul className="space-y-1 text-sm text-blue-800">
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>Files parsed and domains extracted</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" />
                          <span>Subdomain discovery running (subfinder, chaos)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>Fingerprinting with httpx</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>Port scanning with naabu</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>Crawling and vulnerability scanning</span>
                        </li>
                      </ul>
                    </div>
                  </TabsContent>

                  <TabsContent value="jobs" className="space-y-2">
                    {activeJobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between p-3 bg-accent/50 rounded-md"
                      >
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                          <div>
                            <p className="font-medium capitalize">{job.type}</p>
                            <p className="text-xs text-muted-foreground">Job ID: {job.id.slice(0, 16)}...</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {job.status}
                        </Badge>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="scope" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium mb-2">Domains</h4>
                        <p className="text-2xl font-bold text-blue-600">
                          {uploadResult.parsedScope?.domains || 0}
                        </p>
                      </div>
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium mb-2">Subdomains</h4>
                        <p className="text-2xl font-bold text-green-600">
                          {uploadResult.parsedScope?.subdomains || 0}
                        </p>
                      </div>
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium mb-2">IP Addresses</h4>
                        <p className="text-2xl font-bold text-purple-600">
                          {uploadResult.parsedScope?.ips || 0}
                        </p>
                      </div>
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium mb-2">URLs</h4>
                        <p className="text-2xl font-bold text-orange-600">
                          {uploadResult.parsedScope?.urls || 0}
                        </p>
                      </div>
                    </div>

                    {uploadResult.files && (
                      <div className="border rounded-lg p-4">
                        <h4 className="font-medium mb-3">Uploaded Files</h4>
                        <div className="space-y-2">
                          {uploadResult.files.map((file: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <span className="font-mono">{file.name}</span>
                              <span className="text-muted-foreground">
                                {(file.size / 1024).toFixed(1)} KB
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Supported Formats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium mb-2">Plain Text (.txt)</h4>
                  <code className="text-xs text-muted-foreground block">
                    example.com<br />
                    subdomain.example.com<br />
                    https://api.example.com<br />
                    192.168.1.1
                  </code>
                </div>
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium mb-2">HackerOne JSON</h4>
                  <code className="text-xs text-muted-foreground block">
                    {'{'}<br />
                    &nbsp;&nbsp;"targets": [<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;{'{'}...{'}'}<br />
                    &nbsp;&nbsp;]<br />
                    {'}'}
                  </code>
                </div>
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium mb-2">CSV (.csv)</h4>
                  <code className="text-xs text-muted-foreground block">
                    domain,type<br />
                    example.com,domain<br />
                    sub.example.com,subdomain
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
