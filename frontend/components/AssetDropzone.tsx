'use client';

import { useCallback, useState, useRef } from 'react';
import { Upload, FileText, X, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  const uploadFiles = useCallback(async (filesToUpload: File[]) => {
    if (!filesToUpload || filesToUpload.length === 0) {
      setUploadStatus({ status: 'error', message: 'No files selected' });
      return;
    }

    setUploadStatus({ status: 'uploading', message: `Uploading ${filesToUpload.length} file(s)...` });

    try {
      const formData = new FormData();
      
      // Validate and append files
      for (const file of filesToUpload) {
        // Check file size (50MB max)
        if (file.size > 50 * 1024 * 1024) {
          throw new Error(`File "${file.name}" exceeds 50MB limit`);
        }
        // Check file type
        const ext = file.name.toLowerCase().split('.').pop();
        if (!['txt', 'csv', 'json', 'pdf', 'docx', 'doc'].includes(ext || '')) {
          throw new Error(`File "${file.name}" has unsupported format. Use txt, csv, json, pdf, or docx.`);
        }
        formData.append('files', file);
      }

      // Add configuration
      if (programId) {
        formData.append('program_id', programId);
      }
      if (programName) {
        formData.append('program_name', programName);
        formData.append('create_program', 'true');
      } else if (!programId) {
        // Generate a default program name if none provided
        formData.append('program_name', `Upload-${new Date().toISOString().slice(0, 10)}`);
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

      // Handle non-JSON error responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Server error: ${response.status} - ${text.slice(0, 200)}`);
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || `Upload failed (${response.status})`);
      }

      setUploadStatus({
        status: 'success',
        message: `Successfully uploaded ${filesToUpload.length} file(s). ${autoOrchestrate && result.orchestration ? `${result.orchestration.jobs?.length || 0} jobs started!` : 'Assets added.'}`,
        result,
      });

      if (onOrchestrationStarted && result.orchestration) {
        onOrchestrationStarted(result);
      }

      // Also call legacy callback if provided
      if (onAssetsAdded && result.parsedScope) {
        const assets: ParsedAsset[] = [];
        if (Array.isArray(result.parsedScope.domains)) {
          assets.push(...result.parsedScope.domains.map((d: string) => ({ type: 'domain' as const, value: d })));
        }
        if (Array.isArray(result.parsedScope.subdomains)) {
          assets.push(...result.parsedScope.subdomains.map((s: string) => ({ type: 'subdomain' as const, value: s })));
        }
        if (assets.length > 0) {
          onAssetsAdded(assets);
        }
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      setUploadStatus({
        status: 'error',
        message: error?.message || 'Failed to upload files. Please try again.',
      });
    }
  }, [programId, programName, autoOrchestrate, onAssetsAdded, onOrchestrationStarted]);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      try {
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) {
          return;
        }
        setFiles(prev => [...prev, ...droppedFiles]);
        await uploadFiles(droppedFiles);
      } catch (error) {
        console.error('Drop error:', error);
      }
    },
    [uploadFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const selectedFiles = Array.from(e.target.files || []);
        if (selectedFiles.length === 0) {
          return;
        }
        setFiles(prev => [...prev, ...selectedFiles]);
        await uploadFiles(selectedFiles);
      } catch (error) {
        console.error('File input error:', error);
      } finally {
        // Reset input to allow re-selecting same files
        if (e.target) {
          e.target.value = '';
        }
      }
    },
    [uploadFiles]
  );

  const resetUpload = useCallback(() => {
    setUploadStatus({ status: 'idle' });
    setFiles([]);
  }, []);

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

        {uploadStatus.status === 'uploading' ? (
          <p className="text-sm text-blue-600">Please wait...</p>
        ) : uploadStatus.status === 'success' || uploadStatus.status === 'error' ? (
          <button
            onClick={resetUpload}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90"
          >
            <RefreshCw className="w-4 h-4" />
            Upload More Files
          </button>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.csv,.json,.pdf,.docx,.doc"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
            />
            <input
              ref={folderInputRef}
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
            Supports: txt, csv, json, pdf, docx • HackerOne scope • Chaos format • Plain text domains
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
