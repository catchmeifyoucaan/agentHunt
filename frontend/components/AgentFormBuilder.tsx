'use client';

import React from 'react';
import { AgentType } from '@/shared/types';
import { getAgentMetadata, AgentFormOption } from '@/lib/agentMetadata';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Info } from 'lucide-react';

interface AgentFormBuilderProps {
  agentType: AgentType;
  options: Record<string, any>;
  onChange: (options: Record<string, any>) => void;
  errors?: Record<string, string>;
}

export function AgentFormBuilder({
  agentType,
  options,
  onChange,
  errors = {}
}: AgentFormBuilderProps) {
  const metadata = getAgentMetadata(agentType);

  if (!metadata) {
    return <div className="text-gray-500">Agent metadata not available</div>;
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    onChange({
      ...options,
      [fieldName]: value
    });
  };

  const renderField = (field: AgentFormOption) => {
    const value = options[field.name] ?? field.default;
    const hasError = !!errors[field.name];

    switch (field.type) {
      case 'text':
        return (
          <Input
            id={field.name}
            type="text"
            value={value || ''}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            className={hasError ? 'border-red-500' : ''}
            required={field.required}
          />
        );

      case 'number':
        return (
          <Input
            id={field.name}
            type="number"
            value={value ?? ''}
            onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            className={hasError ? 'border-red-500' : ''}
            required={field.required}
          />
        );

      case 'textarea':
        return (
          <Textarea
            id={field.name}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            className={hasError ? 'border-red-500' : ''}
            rows={4}
            required={field.required}
          />
        );

      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={field.name}
              checked={value ?? false}
              onCheckedChange={(checked) => handleFieldChange(field.name, checked)}
            />
            <Label htmlFor={field.name} className="text-sm text-gray-600">
              {value ? 'Enabled' : 'Disabled'}
            </Label>
          </div>
        );

      case 'select':
        return (
          <Select
            value={value || field.default}
            onValueChange={(newValue) => handleFieldChange(field.name, newValue)}
          >
            <SelectTrigger className={hasError ? 'border-red-500' : ''}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'file':
        return (
          <div className="space-y-2">
            <Input
              id={field.name}
              type="text"
              value={value || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder || 's3://bucket/file.txt or /path/to/file'}
              className={hasError ? 'border-red-500' : ''}
              required={field.required}
            />
            <p className="text-xs text-gray-500">
              Enter S3 path (s3://...) or local file path
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Agent Info Header */}
      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-3">
          {React.createElement(metadata.icon, {
            className: `w-6 h-6 text-${metadata.color.replace('bg-', '')}`
          })}
          <div>
            <h3 className="font-semibold text-lg">{metadata.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {metadata.description}
            </p>
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-4">
        {metadata.formOptions.map((field) => (
          <div key={field.name} className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={field.name} className="font-medium">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {field.description && (
                <div className="group relative">
                  <Info className="w-4 h-4 text-gray-400 cursor-help" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-10 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg">
                    {field.description}
                  </div>
                </div>
              )}
            </div>

            {renderField(field)}

            {errors[field.name] && (
              <p className="text-sm text-red-500">{errors[field.name]}</p>
            )}

            {field.min !== undefined && field.max !== undefined && (
              <p className="text-xs text-gray-500">
                Valid range: {field.min} - {field.max}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Examples Section */}
      {metadata.examples && metadata.examples.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Example Use Cases
          </h4>
          <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {metadata.examples.map((example, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-blue-500">•</span>
                <span>{example}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
