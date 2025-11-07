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
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Import Program</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose a platform to import programs from:
        </p>
        <div className="space-y-3">
          <button className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-left">
            HackerOne
          </button>
          <button className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-left">
            Bugcrowd
          </button>
          <button className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-left">
            Chaos DB
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
