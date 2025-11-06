'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000';

export interface WebSocketEvent {
  id: string;
  type: string;
  timestamp: string;
  [key: string]: any;
}

export function useWebSocket(onMessage?: (event: WebSocketEvent) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    try {
      ws.current = new WebSocket(`${WS_URL}/events`);

      ws.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent(data);
          onMessage?.(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);

        // Reconnect after 3 seconds
        reconnectTimeout.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 3000);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, [onMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  }, []);

  return { isConnected, lastEvent, send };
}

export function useEventStream(filter?: { programId?: string; type?: string }) {
  const [events, setEvents] = useState<WebSocketEvent[]>([]);

  const handleMessage = useCallback(
    (event: WebSocketEvent) => {
      // Apply filters
      if (filter?.programId && event.programId !== filter.programId) {
        return;
      }
      if (filter?.type && event.type !== filter.type) {
        return;
      }

      setEvents((prev) => [...prev.slice(-999), event]); // Keep last 1000 events
    },
    [filter]
  );

  const { isConnected, send } = useWebSocket(handleMessage);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, isConnected, send, clearEvents };
}
