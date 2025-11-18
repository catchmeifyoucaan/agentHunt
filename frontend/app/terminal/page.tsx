'use client';

import { useEventStream } from '@/hooks/useWebSocket';
import { useQuery } from '@tanstack/react-query';
import { programsApi } from '@/lib/api';
import { Terminal as TerminalIcon, Download, Trash2, Filter } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { formatDate } from '@/lib/utils';

export default function TerminalPage() {
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { events, clearEvents } = useEventStream({
    programId: selectedProgram || undefined,
  });

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const programs = programsData?.data?.programs || [];

  // Filter events
  const logEvents = events
    .filter((e) => e.type === 'log')
    .filter((e) => !selectedLevel || e.level === selectedLevel);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logEvents, autoScroll]);

  const exportLogs = () => {
    const logsText = logEvents
      .map(
        (e) =>
          `[${formatDate(e.timestamp ?? '')}] [${e.level?.toUpperCase()}] [${e.tool}] ${e.message}`
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TerminalIcon className="w-6 h-6" />
            <div>
              <h1 className="text-2xl font-bold">Live Terminal</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time agent logs and tool output
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
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
              onChange={(e) => setSelectedProgram(e.target.value)}
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
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
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
        {logEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <TerminalIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No logs yet. Start a job to see real-time output.</p>
            </div>
          </div>
        ) : (
          logEvents.map((event) => (
            <div key={event.id} className="terminal-line">
              <span className="terminal-timestamp">
                {new Date(event.timestamp ?? '').toLocaleTimeString()}
              </span>
              <span className={`terminal-level-${event.level}`}>
                [{event.level?.toUpperCase() || 'INFO'}]
              </span>
              <span className="terminal-tool ml-2">[{event.tool}]</span>
              <span className="terminal-message ml-2">
                {event.context && <span className="text-cyan-400">{event.context}: </span>}
                {event.message}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Stats */}
      <div className="p-4 border-t border-border bg-card flex items-center justify-between text-sm">
        <div className="flex gap-6">
          <span>
            Total Events: <span className="font-mono font-bold">{logEvents.length}</span>
          </span>
          <span>
            Errors:{' '}
            <span className="font-mono font-bold text-red-500">
              {logEvents.filter((e) => e.level === 'error').length}
            </span>
          </span>
          <span>
            Warnings:{' '}
            <span className="font-mono font-bold text-yellow-500">
              {logEvents.filter((e) => e.level === 'warn').length}
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
