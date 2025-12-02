'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { programsApi, jobsApi } from '@/lib/api';
import { AgentType } from '@/shared/types';
import { getAllAgents, getAgentMetadata } from '@/lib/agentMetadata';
import { AgentFormBuilder } from '@/components/AgentFormBuilder';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Zap, AlertCircle } from 'lucide-react';
import Link from 'next/link';

function CreateJobContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedType = searchParams.get('type') as AgentType | null;

  const [selectedAgentType, setSelectedAgentType] = useState<AgentType | null>(preselectedType);
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const [priority, setPriority] = useState<number>(5);
  const [options, setOptions] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const createJobMutation = useMutation({
    mutationFn: (data: any) => jobsApi.create(data),
    onSuccess: () => {
      router.push('/jobs');
    },
    onError: (error: any) => {
      alert(`Failed to create job: ${error.message}`);
    },
  });

  const programs = programsData?.data?.programs || [];
  const allAgents = getAllAgents();

  useEffect(() => {
    // Reset options when agent type changes
    if (selectedAgentType) {
      const metadata = getAgentMetadata(selectedAgentType);
      const defaultOptions: Record<string, any> = {};
      if (metadata) {
        metadata.formOptions.forEach((field) => {
          if (field.default !== undefined) {
            defaultOptions[field.name] = field.default;
          }
        });
      }
      setOptions(defaultOptions);
      setErrors({});
    }
  }, [selectedAgentType]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!selectedAgentType) {
      newErrors.agentType = 'Please select an agent type';
      setErrors(newErrors);
      return false;
    }

    const metadata = getAgentMetadata(selectedAgentType);

    if (!metadata) {
      return true; // No metadata to validate
    }

    metadata.formOptions.forEach((field) => {
      if (field.required && !options[field.name]) {
        newErrors[field.name] = `${field.label} is required`;
      }

      // Validate number ranges
      if (field.type === 'number' && options[field.name] !== undefined) {
        const value = Number(options[field.name]);
        if (field.min !== undefined && value < field.min) {
          newErrors[field.name] = `Must be at least ${field.min}`;
        }
        if (field.max !== undefined && value > field.max) {
          newErrors[field.name] = `Must be at most ${field.max}`;
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    createJobMutation.mutate({
      type: selectedAgentType,
      program_id: selectedProgram || undefined,
      priority,
      options,
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/jobs">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Create New Job</h1>
              <p className="text-muted-foreground mt-1">
                Configure and launch a security agent job
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Selection */}
      <Card>
        <CardHeader>
          <CardTitle>1. Select Agent Type</CardTitle>
          <CardDescription>
            Choose the security agent you want to run
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agentType">Agent Type *</Label>
            <Select
              value={selectedAgentType || ''}
              onValueChange={(value) => setSelectedAgentType(value as AgentType)}
            >
              <SelectTrigger className={errors.agentType ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select an agent type" />
              </SelectTrigger>
              <SelectContent className="max-h-[400px]">
                {allAgents.map((agent) => (
                  <SelectItem key={agent.type} value={agent.type}>
                    <div className="flex flex-col">
                      <span className="font-medium">{agent.name}</span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {agent.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.agentType && (
              <p className="text-sm text-red-500">{errors.agentType}</p>
            )}
          </div>

          {/* Selected agent info */}
          {selectedAgentType && (
            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <h4 className="font-semibold">{getAgentMetadata(selectedAgentType)?.name}</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    {getAgentMetadata(selectedAgentType)?.description}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs px-2 py-1 bg-background rounded capitalize">
                      {getAgentMetadata(selectedAgentType)?.category}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Configuration */}
      {selectedAgentType && (
        <Card>
          <CardHeader>
            <CardTitle>2. Configure Agent Options</CardTitle>
            <CardDescription>
              Set parameters specific to the selected agent
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AgentFormBuilder
              agentType={selectedAgentType}
              options={options}
              onChange={setOptions}
              errors={errors}
            />
          </CardContent>
        </Card>
      )}

      {/* Job Settings */}
      {selectedAgentType && (
        <Card>
          <CardHeader>
            <CardTitle>3. Job Settings</CardTitle>
            <CardDescription>
              Configure program association and priority
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="program">Program (Optional)</Label>
              <Select
                value={selectedProgram}
                onValueChange={setSelectedProgram}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a program (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No Program</SelectItem>
                  {programs.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Associate this job with a program for better organization
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority: {priority}</Label>
              <input
                id="priority"
                type="range"
                min="1"
                max="10"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Low (1)</span>
                <span>Medium (5)</span>
                <span>High (10)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Higher priority jobs are processed first
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {selectedAgentType && (
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            <span>
              Review your configuration carefully before creating the job
            </span>
          </div>
          <div className="flex gap-2">
            <Link href="/jobs">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button
              onClick={handleSubmit}
              disabled={createJobMutation.isPending}
            >
              {createJobMutation.isPending ? (
                <>Creating...</>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Create Job
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {!selectedAgentType && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Select an agent type to get started</p>
        </div>
      )}
    </div>
  );
}

export default function CreateJobPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <CreateJobContent />
    </Suspense>
  );
}
