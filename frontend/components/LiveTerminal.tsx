'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useEventStream, WebSocketEvent } from '@/hooks/useWebSocket';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Terminal, Download, Trash2, Wifi, WifiOff, Pause, Play } from 'lucide-react';

interface LiveTerminalProps {
  jobId?: string;
  programId?: string;
  title?: string;
  height?: string;
  showControls?: boolean;
}

export function LiveTerminal({
  jobId,
  programId,
  title = 'Live Terminal',
  height = '500px',
  showControls = true,
}: LiveTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [displayEvents, setDisplayEvents] = useState<WebSocketEvent[]>([]);

  // Filter events by jobId or programId
  const filter = jobId ? { jobId } : programId ? { programId } : undefined;
  const { events, isConnected, clearEvents } = useEventStream(filter as any);

  // Update display events only when not paused
  useEffect(() => {
    if (!isPaused) {
      setDisplayEvents(events);
    }
  }, [events, isPaused]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [displayEvents, autoScroll]);

  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleDownload = () => {
    const content = displayEvents
      .map((event) => {
        const timestamp = new Date(event.timestamp).toISOString();
        return `[${timestamp}] [${event.type}] ${formatEventMessage(event)}`;
      })
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal-${jobId || programId || 'all'}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatEventMessage = (event: WebSocketEvent): string => {
    switch (event.type) {
      case 'log':
        return event.message || JSON.stringify(event);
      case 'job_status':
        return `Job ${event.jobId?.slice(0, 8)}: ${event.job?.status}`;
      case 'finding':
        return `New finding: ${event.finding?.title} (${event.finding?.severity})`;
      case 'progress':
        return `${event.message || 'Progress'}: ${event.current}/${event.total} (${event.percentage}%)`;
      case 'human_action_request':
        return `Action required: ${event.action} - ${event.reason}`;
      case 'connection':
        return `Connected (Client ID: ${event.clientId})`;
      default:
        return JSON.stringify(event, null, 2);
    }
  };

  const getEventColor = (event: WebSocketEvent): string => {
    switch (event.type) {
      case 'log':
        switch (event.level) {
          case 'error':
            return 'text-red-400';
          case 'warn':
            return 'text-yellow-400';
          case 'debug':
            return 'text-gray-400';
          default:
            return 'text-green-400';
        }
      case 'finding':
        switch (event.finding?.severity) {
          case 'critical':
            return 'text-red-500 font-bold';
          case 'high':
            return 'text-orange-500';
          case 'medium':
            return 'text-yellow-500';
          default:
            return 'text-blue-400';
        }
      case 'human_action_request':
        return 'text-purple-400 font-semibold';
      case 'progress':
        return 'text-cyan-400';
      case 'job_status':
        return 'text-blue-400';
      case 'connection':
        return 'text-green-500';
      default:
        return 'text-gray-300';
    }
  };

  const getTypeIcon = (type: string): string => {
    const icons: Record<string, string> = {
      log: '📝',
      finding: '🔍',
      job_status: '⚙️',
      progress: '📊',
      human_action_request: '👤',
      connection: '🔌',
    };
    return icons[type] || '•';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5" />
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {jobId && `Job: ${jobId.slice(0, 8)}`}
                {programId && `Program: ${programId.slice(0, 8)}`}
                {!jobId && !programId && 'All events'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? 'default' : 'secondary'} className="gap-1">
              {isConnected ? (
                <>
                  <Wifi className="w-3 h-3" />
                  Connected
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  Disconnected
                </>
              )}
            </Badge>
            <Badge variant="outline">{displayEvents.length} events</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {showControls && (
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? (
                <>
                  <Play className="w-4 h-4 mr-1" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 mr-1" />
                  Pause
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={displayEvents.length === 0}
            >
              <Download className="w-4 h-4 mr-1" />
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearEvents();
                setDisplayEvents([]);
              }}
              disabled={displayEvents.length === 0}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
            <div className="ml-auto text-xs text-muted-foreground">
              {autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
            </div>
          </div>
        )}

        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="font-mono text-sm bg-gray-950 text-gray-100 p-4 rounded-lg overflow-y-auto space-y-1"
          style={{ height }}
        >
          {displayEvents.length === 0 && (
            <div className="text-gray-500 text-center py-8">
              {isConnected ? (
                <div>
                  <Terminal className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Waiting for events...</p>
                  {jobId && <p className="text-xs mt-1">Filtering by job: {jobId.slice(0, 8)}</p>}
                </div>
              ) : (
                <div>
                  <WifiOff className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Connecting to event stream...</p>
                </div>
              )}
            </div>
          )}

          {displayEvents.map((event, index) => (
            <div key={`${event.id}-${index}`} className="flex items-start gap-2 hover:bg-gray-900 px-2 py-1 rounded">
              <span className="text-gray-600 text-xs shrink-0 w-24">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span className="shrink-0">{getTypeIcon(event.type)}</span>
              <span className={`flex-1 break-words ${getEventColor(event)}`}>
                {formatEventMessage(event)}
              </span>
            </div>
          ))}

          {isPaused && (
            <div className="sticky bottom-0 left-0 right-0 bg-yellow-900/50 text-yellow-300 text-center py-2 rounded">
              Terminal paused - {events.length - displayEvents.length} new events hidden
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
