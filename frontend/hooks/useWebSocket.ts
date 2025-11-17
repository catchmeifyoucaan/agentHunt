'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000';

export interface WebSocketEvent {
  id?: string;
  type: string;
  channel?: string;
  data?: any;
  timestamp?: string;
  [key: string]: any;
}

export interface SubscribeOptions {
  programId?: string;
  jobId?: string;
  handoffId?: string;
  agentType?: string;
  workflowId?: string;
  severity?: string;
  subscribeAll?: boolean;
}

export function useWebSocket(onMessage?: (event: WebSocketEvent) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();
  const pendingSubscriptions = useRef<SubscribeOptions[]>([]);

  const connect = useCallback(() => {
    try {
      // Connect to /ws endpoint for real-time Redis pub/sub updates
      ws.current = new WebSocket(`${WS_URL}/ws`);

      ws.current.onopen = () => {
        console.log('✅ WebSocket connected to real-time updates');
        setIsConnected(true);

        // Send any pending subscriptions
        if (pendingSubscriptions.current.length > 0) {
          pendingSubscriptions.current.forEach((sub) => {
            ws.current?.send(JSON.stringify({ type: 'subscribe', ...sub }));
          });
          pendingSubscriptions.current = [];
        }
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent(data);
          onMessage?.(data);

          // Log real-time events
          if (data.type !== 'connected' && data.type !== 'ping' && data.type !== 'pong') {
            console.log(`📡 Real-time event:`, data.type, data);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      ws.current.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);

        // Reconnect after 3 seconds
        reconnectTimeout.current = setTimeout(() => {
          console.log('🔄 Attempting to reconnect...');
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
    } else {
      console.warn('WebSocket not connected, queuing message');
    }
  }, []);

  const subscribe = useCallback((options: SubscribeOptions) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'subscribe', ...options }));
      console.log('📬 Subscribed to:', options);
    } else {
      // Queue subscription for when connection is established
      pendingSubscriptions.current.push(options);
      console.log('📬 Queued subscription for:', options);
    }
  }, []);

  const unsubscribe = useCallback((options: SubscribeOptions) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'unsubscribe', ...options }));
      console.log('📭 Unsubscribed from:', options);
    }
  }, []);

  return { isConnected, lastEvent, send, subscribe, unsubscribe };
}

export function useEventStream(filter?: { programId?: string; jobId?: string; type?: string; handoffId?: string }) {
  const [events, setEvents] = useState<WebSocketEvent[]>([]);

  const handleMessage = useCallback(
    (event: WebSocketEvent) => {
      // Apply filters
      if (filter?.programId && event.data?.programId !== filter.programId) {
        return;
      }
      if (filter?.jobId && event.data?.jobId !== filter.jobId) {
        return;
      }
      if (filter?.handoffId && event.data?.handoffId !== filter.handoffId) {
        return;
      }
      if (filter?.type && event.type !== filter.type) {
        return;
      }

      setEvents((prev) => [...prev.slice(-999), event]); // Keep last 1000 events
    },
    [filter]
  );

  const { isConnected, send, subscribe, unsubscribe } = useWebSocket(handleMessage);

  // Auto-subscribe based on filter
  useEffect(() => {
    if (isConnected && filter) {
      subscribe(filter);

      return () => {
        unsubscribe(filter);
      };
    }
  }, [isConnected, filter, subscribe, unsubscribe]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, isConnected, send, subscribe, unsubscribe, clearEvents };
}
