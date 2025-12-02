'use client';

import { useEventStream } from '@/hooks/useWebSocket';
import { useQuery } from '@tanstack/react-query';
import { programsApi } from '@/lib/api';
import { Terminal as TerminalIcon, Download, Trash2, Filter, Activity, Zap } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { formatDate } from '@/lib/utils';

// Event types we want to show in the terminal
const TERMINAL_EVENT_TYPES = ['log', 'job:progress', 'agent:health', 'workflow:progress', 'handoff:status'];

export default function TerminalPage() {
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { events, clearEvents, isConnected } = useEventStream({
    programId: selectedProgram || undefined,
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const programs = programsData?.data?.programs || [];

  // Transform and filter events for terminal display
  const terminalEvents = events
    .filter((e) => {
      // Filter by event type
      if (selectedEventType && e.type !== selectedEventType) return false;
      // For log events, also filter by level
      if (e.type === 'log' && selectedLevel && e.level !== selectedLevel) return false;
      // Show all relevant event types
      return TERMINAL_EVENT_TYPES.includes(e.type) || e.type?.startsWith('program:');
    })
    .map((e) => {
      // Normalize event structure for display
      if (e.type === 'log') {
        return {
          ...e,
          displayLevel: e.level || 'info',
          displayTool: e.tool || 'system',
          displayMessage: e.message || JSON.stringify(e.data),
        };
      } else if (e.type === 'job:progress') {
        return {
          ...e,
          displayLevel: 'info',
          displayTool: e.data?.agentType || 'job',
          displayMessage: `Job ${e.data?.jobId?.slice(0, 8) || 'unknown'}: ${e.data?.status || 'processing'} - ${e.data?.message || e.data?.step || 'in progress'}`,
        };
      } else if (e.type === 'agent:health') {
        return {
          ...e,
          displayLevel: e.data?.status === 'healthy' ? 'info' : 'warn',
          displayTool: e.data?.agentType || 'agent',
          displayMessage: `Agent health: ${e.data?.status || 'unknown'} (${e.data?.metrics?.jobsProcessed || 0} jobs processed)`,
        };
      } else if (e.type === 'handoff:status') {
        return {
          ...e,
          displayLevel: 'info',
          displayTool: 'handoff',
          displayMessage: `Handoff ${e.data?.from || '?'} → ${e.data?.to || '?'}: ${e.data?.status || 'pending'}`,
        };
      } else {
        return {
          ...e,
          displayLevel: 'debug',
          displayTool: e.type?.split(':')[0] || 'system',
          displayMessage: e.data?.message || JSON.stringify(e.data || e).slice(0, 200),
        };
      }
    });

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalEvents, autoScroll]);

  const exportLogs = () => {
    const logsText = terminalEvents
      .map(
        (e: any) =>
          `[${formatDate(e.timestamp ?? '')}] [${e.displayLevel?.toUpperCase()}] [${e.displayTool}] ${e.displayMessage}`
      )
      .join('\n');

    const blob = new Blob([logsText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agenthunt-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      case 'info': return 'text-green-400';
      case 'debug': return 'text-gray-400';
      default: return 'text-green-400';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TerminalIcon className="w-6 h-6" />
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                Live Terminal
                {isConnected ? (
                  <span className="flex items-center gap-1 text-xs text-green-500">
                    <Zap className="w-3 h-3" /> Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <Activity className="w-3 h-3" /> Disconnected
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time agent logs, job progress, and system events
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAutoScroll(e.target.checked)}
                className="rounded"
              />
              Auto-scroll
            </label>

            <button
              onClick={exportLogs}
              className="px-3 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm flex items-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export
            </button>

            <button
              onClick={clearEvents}
              className="px-3 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-md text-sm flex items-center gap-2 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mt-4">
          <div className="flex-1">
            <select
              value={selectedProgram}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedProgram(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Programs</option>
              {programs.map((program: any) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-48">
            <select
              value={selectedEventType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedEventType(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Event Types</option>
              <option value="log">Agent Logs</option>
              <option value="job:progress">Job Progress</option>
              <option value="agent:health">Agent Health</option>
              <option value="handoff:status">Handoffs</option>
              <option value="workflow:progress">Workflows</option>
            </select>
          </div>

          <div className="w-36">
            <select
              value={selectedLevel}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedLevel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-auto bg-black text-green-400 terminal p-4 font-mono text-sm"
      >
        {terminalEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <TerminalIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="mb-2">No events yet.</p>
              <p className="text-xs">Start a job or run a scan to see real-time output.</p>
              <p className="text-xs mt-2 text-gray-600">
                {isConnected ? '✓ WebSocket connected' : '✗ WebSocket disconnected - events may not appear'}
              </p>
            </div>
          </div>
        ) : (
          terminalEvents.map((event: any, index: number) => (
            <div key={event.id || index} className="terminal-line hover:bg-gray-900/50 py-0.5">
              <span className="text-gray-500">
                {new Date(event.timestamp ?? '').toLocaleTimeString()}
              </span>
              <span className={`ml-2 ${getLevelColor(event.displayLevel)}`}>
                [{event.displayLevel?.toUpperCase() || 'INFO'}]
              </span>
              <span className="text-cyan-400 ml-2">[{event.displayTool}]</span>
              <span className="text-green-300 ml-2">
                {event.displayMessage}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Stats */}
      <div className="p-4 border-t border-border bg-card flex items-center justify-between text-sm">
        <div className="flex gap-6">
          <span>
            Total Events: <span className="font-mono font-bold">{terminalEvents.length}</span>
          </span>
          <span>
            Errors:{' '}
            <span className="font-mono font-bold text-red-500">
              {terminalEvents.filter((e: any) => e.displayLevel === 'error').length}
            </span>
          </span>
          <span>
            Warnings:{' '}
            <span className="font-mono font-bold text-yellow-500">
              {terminalEvents.filter((e: any) => e.displayLevel === 'warn').length}
            </span>
          </span>
          <span>
            Jobs:{' '}
            <span className="font-mono font-bold text-blue-500">
              {events.filter((e: any) => e.type === 'job:progress').length}
            </span>
          </span>
        </div>
        <span className="text-muted-foreground">
          {autoScroll ? 'Auto-scrolling enabled' : 'Auto-scroll disabled'}
        </span>
      </div>
    </div>
  );
}
