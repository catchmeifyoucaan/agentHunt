'use client';

import { useCallback, useState } from 'react';
import { Upload, FileText, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface AssetDropzoneProps {
  onAssetsAdded?: (assets: ParsedAsset[]) => void;
  programId?: string;
  programName?: string;
  autoOrchestrate?: boolean;
  onOrchestrationStarted?: (result: any) => void;
}

export interface ParsedAsset {
  type: 'url' | 'ip' | 'domain' | 'subdomain';
  value: string;
}

interface UploadStatus {
  status: 'idle' | 'uploading' | 'success' | 'error';
  message?: string;
  result?: any;
}

export function AssetDropzone({
  onAssetsAdded,
  programId,
  programName,
  autoOrchestrate = true,
  onOrchestrationStarted
}: AssetDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ status: 'idle' });

  const parseAssets = (text: string): ParsedAsset[] => {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const assets: ParsedAsset[] = [];

    for (const line of lines) {
      // URL detection
      if (line.match(/^https?:\/\//)) {
        assets.push({ type: 'url', value: line });
      }
      // IP address detection
      else if (line.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
        assets.push({ type: 'ip', value: line });
      }
      // Subdomain detection (has dots)
      else if (line.includes('.') && !line.includes('/')) {
        // Count dots to determine if subdomain or domain
        const dotCount = (line.match(/\./g) || []).length;
        if (dotCount > 1 || line.split('.')[0].length > 3) {
          assets.push({ type: 'subdomain', value: line });
        } else {
          assets.push({ type: 'domain', value: line });
        }
      }
      // Default to domain
      else {
        assets.push({ type: 'domain', value: line });
      }
    }

    return assets;
  };

  const uploadFiles = async (filesToUpload: File[]) => {
    setUploadStatus({ status: 'uploading', message: 'Uploading and parsing files...' });

    try {
      const formData = new FormData();
      filesToUpload.forEach(file => {
        formData.append('files', file);
      });

      // Add configuration
      if (programId) {
        formData.append('program_id', programId);
      }
      if (programName) {
        formData.append('program_name', programName);
        formData.append('create_program', 'true');
      }
      formData.append('run_discovery', autoOrchestrate ? 'true' : 'false');
      formData.append('run_subdomain_enum', autoOrchestrate ? 'true' : 'false');
      formData.append('run_fingerprinting', autoOrchestrate ? 'true' : 'false');
      formData.append('run_port_scan', autoOrchestrate ? 'true' : 'false');
      formData.append('run_crawling', autoOrchestrate ? 'true' : 'false');
      formData.append('run_scanning', autoOrchestrate ? 'true' : 'false');

      const response = await fetch('/api/v1/uploads/scope', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();

      setUploadStatus({
        status: 'success',
        message: `Successfully uploaded ${filesToUpload.length} files. ${autoOrchestrate ? 'Orchestration started!' : 'Assets added.'}`,
        result,
      });

      if (onOrchestrationStarted && result.orchestration) {
        onOrchestrationStarted(result);
      }

      // Also call legacy callback if provided
      if (onAssetsAdded && result.parsedScope) {
        const assets: ParsedAsset[] = [
          ...result.parsedScope.domains.map((d: string) => ({ type: 'domain' as const, value: d })),
          ...result.parsedScope.subdomains.map((s: string) => ({ type: 'subdomain' as const, value: s })),
        ];
        onAssetsAdded(assets);
      }
    } catch (error: any) {
      setUploadStatus({
        status: 'error',
        message: error.message || 'Failed to upload files',
      });
    }
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      setFiles(prev => [...prev, ...droppedFiles]);

      // Upload files to backend
      await uploadFiles(droppedFiles);
    },
    [programId, programName, autoOrchestrate]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      setFiles(prev => [...prev, ...selectedFiles]);

      // Upload files to backend
      await uploadFiles(selectedFiles);

      // Reset input
      e.target.value = '';
    },
    [programId, programName, autoOrchestrate]
  );

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : uploadStatus.status === 'uploading'
            ? 'border-blue-500 bg-blue-50'
            : uploadStatus.status === 'success'
            ? 'border-green-500 bg-green-50'
            : uploadStatus.status === 'error'
            ? 'border-red-500 bg-red-50'
            : 'border-border hover:border-primary/50'
        }`}
      >
        {uploadStatus.status === 'uploading' && (
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-blue-500 animate-spin" />
        )}
        {uploadStatus.status === 'success' && (
          <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
        )}
        {uploadStatus.status === 'error' && (
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        )}
        {uploadStatus.status === 'idle' && (
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        )}

        <p className="text-lg font-medium mb-2">
          {uploadStatus.status === 'uploading' && 'Uploading files...'}
          {uploadStatus.status === 'success' && 'Upload successful!'}
          {uploadStatus.status === 'error' && 'Upload failed'}
          {uploadStatus.status === 'idle' && 'Drop asset files or folders here'}
        </p>

        {uploadStatus.message && (
          <p className={`text-sm mb-4 ${
            uploadStatus.status === 'error' ? 'text-red-600' :
            uploadStatus.status === 'success' ? 'text-green-600' :
            'text-muted-foreground'
          }`}>
            {uploadStatus.message}
          </p>
        )}

        {uploadStatus.status === 'idle' && (
          <p className="text-sm text-muted-foreground mb-4">
            or click to browse files/folders
          </p>
        )}

        {uploadStatus.status === 'success' && uploadStatus.result && (
          <div className="text-sm text-left bg-white/50 rounded p-4 mb-4 max-w-md mx-auto">
            <p className="font-medium mb-2">Parsed Assets:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>Domains: {uploadStatus.result.parsedScope?.domains || 0}</li>
              <li>Subdomains: {uploadStatus.result.parsedScope?.subdomains || 0}</li>
              <li>IPs: {uploadStatus.result.parsedScope?.ips || 0}</li>
              <li>URLs: {uploadStatus.result.parsedScope?.urls || 0}</li>
            </ul>
            {uploadStatus.result.orchestration && (
              <p className="mt-2 text-green-600 font-medium">
                {uploadStatus.result.orchestration.jobs.length} reconnaissance jobs started
              </p>
            )}
          </div>
        )}

        {uploadStatus.status !== 'uploading' && (
          <>
            <input
              type="file"
              multiple
              accept=".txt,.csv,.json"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
            />
            <input
              type="file"
              // @ts-ignore - webkitdirectory is not in the type definitions
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFileInput}
              className="hidden"
              id="folder-upload"
            />
            <div className="flex gap-2 justify-center">
              <label
                htmlFor="file-upload"
                className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 cursor-pointer"
              >
                Choose Files
              </label>
              <label
                htmlFor="folder-upload"
                className="inline-block px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 cursor-pointer"
              >
                Choose Folder
              </label>
            </div>
          </>
        )}

        {uploadStatus.status === 'idle' && (
          <p className="text-xs text-muted-foreground mt-4">
            Supports: txt, csv, json files • HackerOne scope • Chaos format • Plain text domains
          </p>
        )}
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Uploaded Files:</p>
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-accent/50 rounded-md"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <button
                onClick={() => removeFile(index)}
                className="text-red-500 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
