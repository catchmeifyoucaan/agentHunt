'use client';

import { useState, useEffect } from 'react';
import { Settings, Bell, Shield, Zap, Database, CheckCircle, AlertCircle } from 'lucide-react';
import { settingsApi } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState({
    notifications: {
      email: true,
      slack: false,
      discord: false,
    },
    security: {
      autoApprove: false,
      requireHumanApproval: true,
      maxConcurrentJobs: 10,
    },
    integrations: {
      hackerOneApiKey: '',
      bugcrowdApiKey: '',
      chaosApiKey: '',
      chaosDbEnabled: true,
    },
    performance: {
      queueConcurrency: 5,
      retryAttempts: 3,
      timeout: 300,
    },
  });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // Load settings from backend
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  });

  // Update local state when settings are loaded
  useEffect(() => {
    if (settingsData?.data?.settings) {
      setSettings(settingsData.data.settings);
    }
  }, [settingsData]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data: any) => settingsApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
    onError: () => {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
  });

  const handleSave = () => {
    setSaveStatus('saving');
    saveMutation.mutate(settings);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure AgentHunt platform settings and integrations
        </p>
      </div>

      <div className="space-y-6">
        {/* Notifications */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Notifications</h2>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-sm">Email Notifications</span>
              <input
                type="checkbox"
                checked={settings.notifications.email}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    notifications: { ...settings.notifications, email: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Slack Integration</span>
              <input
                type="checkbox"
                checked={settings.notifications.slack}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    notifications: { ...settings.notifications, slack: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Discord Webhooks</span>
              <input
                type="checkbox"
                checked={settings.notifications.discord}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    notifications: { ...settings.notifications, discord: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
            </label>
          </div>
        </div>

        {/* Security */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Security & Policies</h2>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Require Human Approval</p>
                <p className="text-xs text-muted-foreground">
                  Require manual approval for destructive actions
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.security.requireHumanApproval}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    security: { ...settings.security, requireHumanApproval: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Approve Safe Actions</p>
                <p className="text-xs text-muted-foreground">
                  Automatically approve reconnaissance and discovery
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.security.autoApprove}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    security: { ...settings.security, autoApprove: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
            </label>
            <div>
              <label className="block text-sm font-medium mb-1">Max Concurrent Jobs</label>
              <input
                type="number"
                value={settings.security.maxConcurrentJobs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    security: { ...settings.security, maxConcurrentJobs: parseInt(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
          </div>
        </div>

        {/* Integrations */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Platform Integrations</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">HackerOne API Key</label>
              <input
                type="password"
                value={settings.integrations.hackerOneApiKey}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    integrations: { ...settings.integrations, hackerOneApiKey: e.target.value },
                  })
                }
                placeholder="Enter your HackerOne API key"
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bugcrowd API Key</label>
              <input
                type="password"
                value={settings.integrations.bugcrowdApiKey}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    integrations: { ...settings.integrations, bugcrowdApiKey: e.target.value },
                  })
                }
                placeholder="Enter your Bugcrowd API key"
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Chaos API Key</label>
              <input
                type="password"
                value={settings.integrations.chaosApiKey}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    integrations: { ...settings.integrations, chaosApiKey: e.target.value },
                  })
                }
                placeholder="Enter your Chaos API key"
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
            <label className="flex items-center justify-between">
              <span className="text-sm">Enable Chaos DB</span>
              <input
                type="checkbox"
                checked={settings.integrations.chaosDbEnabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    integrations: { ...settings.integrations, chaosDbEnabled: e.target.checked },
                  })
                }
                className="w-4 h-4"
              />
            </label>
          </div>
        </div>

        {/* Performance */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Performance</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Queue Concurrency</label>
              <input
                type="number"
                value={settings.performance.queueConcurrency}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    performance: { ...settings.performance, queueConcurrency: parseInt(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Retry Attempts</label>
              <input
                type="number"
                value={settings.performance.retryAttempts}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    performance: { ...settings.performance, retryAttempts: parseInt(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Job Timeout (seconds)</label>
              <input
                type="number"
                value={settings.performance.timeout}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    performance: { ...settings.performance, timeout: parseInt(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 bg-background border border-border rounded-md"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end items-center gap-3">
          {saveStatus === 'success' && (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <span className="text-sm">Settings saved successfully!</span>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">Failed to save settings</span>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
