'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { programsApi, integrationsApi } from '@/lib/api';
import { useState } from 'react';
import { Plus, Trash2, ExternalLink, Download } from 'lucide-react';
import Link from 'next/link';

export default function ProgramsPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const { data: programsData, isLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => programsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setShowCreateModal(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => programsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
  });

  const programs = programsData?.data?.programs || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Programs</h1>
          <p className="text-muted-foreground mt-1">
            Manage bug bounty programs and security targets
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Import from Platform
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Program
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
        </div>
      ) : programs.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-4">No programs yet. Get started by creating your first program!</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Create Program
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map((program: any) => (
            <div key={program.id} className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{program.name}</h3>
                  <p className="text-sm text-muted-foreground">{program.slug}</p>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(program.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Assets</span>
                  <span className="font-medium">{program.asset_count || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Findings</span>
                  <span className="font-medium">{program.finding_count || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`px-2 py-1 rounded text-xs ${
                    program.status === 'active'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300'
                  }`}>
                    {program.status || 'active'}
                  </span>
                </div>
              </div>

              <Link
                href={`/programs/${program.id}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                View Details <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateProgramModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={(data) => createMutation.mutate(data)}
        />
      )}

      {showImportModal && (
        <ImportProgramModal
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

function CreateProgramModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void }) {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create New Program</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Program Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug</label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-md"
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportProgramModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selectedPlatform, setSelectedPlatform] = useState<'hackerone' | 'bugcrowd' | 'chaos' | null>(null);
  const [availablePrograms, setAvailablePrograms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPrograms = async (platform: 'hackerone' | 'bugcrowd' | 'chaos') => {
    setLoading(true);
    setError(null);
    try {
      let response;
      if (platform === 'hackerone') {
        response = await integrationsApi.hackerOne.getPrograms();
      } else if (platform === 'bugcrowd') {
        response = await integrationsApi.bugcrowd.getPrograms();
      } else {
        response = await integrationsApi.chaos.getPrograms();
      }
      setAvailablePrograms(response.data.programs || []);
      setSelectedPlatform(platform);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load programs. Check your API key in settings.');
    } finally {
      setLoading(false);
    }
  };

  const importProgram = async (program: any) => {
    setImporting(true);
    setError(null);
    try {
      if (selectedPlatform === 'chaos') {
        await integrationsApi.chaos.importProgram(program.name);
      } else {
        // For HackerOne/Bugcrowd, create the program first, then sync
        const createResponse = await programsApi.create({
          name: program.name,
          slug: program.handle || program.code || program.name.toLowerCase().replace(/\s+/g, '-'),
          platform: selectedPlatform,
          metadata: selectedPlatform === 'hackerone' ? { h1_handle: program.handle } : { bugcrowd_code: program.code },
        });

        const programId = createResponse.data.id;
        if (selectedPlatform === 'hackerone') {
          await integrationsApi.hackerOne.sync(programId);
        } else if (selectedPlatform === 'bugcrowd') {
          await integrationsApi.bugcrowd.sync(programId);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['programs'] });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to import program');
    } finally {
      setImporting(false);
    }
  };

  if (!selectedPlatform) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md">
          <h2 className="text-xl font-bold mb-4">Import Program</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Choose a platform to import programs from:
          </p>
          {error && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-md text-sm">
              {error}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => loadPrograms('hackerone')}
              disabled={loading}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-left disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'HackerOne'}
            </button>
            <button
              onClick={() => loadPrograms('bugcrowd')}
              disabled={loading}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-left disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Bugcrowd'}
            </button>
            <button
              onClick={() => loadPrograms('chaos')}
              disabled={loading}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-left disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Chaos DB'}
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">
            Import from {selectedPlatform === 'hackerone' ? 'HackerOne' : selectedPlatform === 'bugcrowd' ? 'Bugcrowd' : 'Chaos DB'}
          </h2>
          <button
            onClick={() => setSelectedPlatform(null)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-md text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          </div>
        ) : availablePrograms.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground">No programs found</p>
        ) : (
          <div className="space-y-2">
            {availablePrograms.map((program: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-3 bg-background border border-border rounded-md">
                <div>
                  <p className="font-medium">{program.name}</p>
                  {program.handle && <p className="text-sm text-muted-foreground">{program.handle}</p>}
                  {program.url && <p className="text-sm text-muted-foreground">{program.url}</p>}
                </div>
                <button
                  onClick={() => importProgram(program)}
                  disabled={importing}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
