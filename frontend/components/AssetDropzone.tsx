'use client';

import { useCallback, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';

interface AssetDropzoneProps {
  onAssetsAdded: (assets: ParsedAsset[]) => void;
}

export interface ParsedAsset {
  type: 'url' | 'ip' | 'domain' | 'subdomain';
  value: string;
}

export function AssetDropzone({ onAssetsAdded }: AssetDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

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

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      setFiles(prev => [...prev, ...droppedFiles]);

      // Parse all files
      const allAssets: ParsedAsset[] = [];

      for (const file of droppedFiles) {
        const text = await file.text();
        const assets = parseAssets(text);
        allAssets.push(...assets);
      }

      if (allAssets.length > 0) {
        onAssetsAdded(allAssets);
      }
    },
    [onAssetsAdded]
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

      const allAssets: ParsedAsset[] = [];

      for (const file of selectedFiles) {
        const text = await file.text();
        const assets = parseAssets(text);
        allAssets.push(...assets);
      }

      if (allAssets.length > 0) {
        onAssetsAdded(allAssets);
      }
    },
    [onAssetsAdded]
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
            : 'border-border hover:border-primary/50'
        }`}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg font-medium mb-2">Drop asset files here</p>
        <p className="text-sm text-muted-foreground mb-4">
          or click to browse
        </p>
        <input
          type="file"
          multiple
          accept=".txt,.csv,.json"
          onChange={handleFileInput}
          className="hidden"
          id="file-upload"
        />
        <label
          htmlFor="file-upload"
          className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 cursor-pointer"
        >
          Choose Files
        </label>
        <p className="text-xs text-muted-foreground mt-4">
          Supports: URLs, IPs, domains, subdomains (txt, csv, json)
        </p>
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
