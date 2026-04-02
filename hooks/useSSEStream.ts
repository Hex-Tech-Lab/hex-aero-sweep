import { useEffect, useRef, useState, useCallback } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';

type SSEMessage = {
  type: 'metrics' | 'log' | 'candidate' | 'complete' | 'error' | 'progress';
  data: any;
};

type UseSSEStreamOptions = {
  sessionId: string;
  searchWindowStart: string;
  searchWindowEnd: string;
  minNights: number;
  maxNights: number;
  priceTolerance: number;
  maxApiCalls: number;
  baseCost: number;
  passengers: number;
  directFlightOnly?: boolean;
  outboundTimePreference?: string;
  inboundTimePreference?: string;
  passengerBreakdown?: {
    adults?: number;
    children?: number;
    infants?: number;
    passengerTypeSource?: string;
  };
  onComplete?: () => void;
  onError?: (error: string) => void;
};

const BATCH_INTERVAL_MS = 200;
const MAX_BATCH_SIZE = 50;

export function useSSEStream() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const flushIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const candidateBufferRef = useRef<any[]>([]);
  const metricsBufferRef = useRef<any>(null);
  const logBufferRef = useRef<any[]>([]);
  const isFlushingRef = useRef(false);

  const { setMetrics, addLog, addFlightResult, ticket } = useTicketStore();

  const flushBuffers = useCallback(() => {
    if (isFlushingRef.current) return;
    isFlushingRef.current = true;

    try {
      if (candidateBufferRef.current.length > 0) {
        const candidates = candidateBufferRef.current.splice(0, MAX_BATCH_SIZE);
        candidates.forEach(candidate => addFlightResult(candidate));
      }

      if (metricsBufferRef.current) {
        setMetrics(metricsBufferRef.current);
        metricsBufferRef.current = null;
      }

      if (logBufferRef.current.length > 0) {
        const logs = logBufferRef.current.splice(0, 50);
        logs.forEach(log => addLog(log));
      }
    } finally {
      isFlushingRef.current = false;
    }
  }, [setMetrics, addLog, addFlightResult]);

  const connect = (options: UseSSEStreamOptions) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
    }

    candidateBufferRef.current = [];
    metricsBufferRef.current = null;
    logBufferRef.current = [];

    const params = new URLSearchParams({
      sessionId: options.sessionId,
      searchWindowStart: options.searchWindowStart,
      searchWindowEnd: options.searchWindowEnd,
      minNights: String(options.minNights ?? 0),
      maxNights: String(options.maxNights ?? 14),
      priceTolerance: String(options.priceTolerance ?? 50),
      maxApiCalls: String(options.maxApiCalls ?? 100),
      baseCost: String(options.baseCost ?? 0),
      passengers: String(options.passengers ?? 1),
      origin: ticket.departureDate ? 'CAI' : 'CAI',
      destination: ticket.departureDate ? 'ATH' : 'ATH',
      carrier: ticket.passengers.length > 0 ? 'A3' : 'A3',
      departureDate: ticket.departureDate ? new Date(ticket.departureDate).toISOString().split('T')[0] : '',
      returnDepartureDate: ticket.departureDate ? new Date(ticket.departureDate).toISOString().split('T')[0] : '',
      directFlightOnly: String(options.directFlightOnly ?? false),
      outboundTimePreference: options.outboundTimePreference || 'any',
      inboundTimePreference: options.inboundTimePreference || 'any',
    });

    if (options.passengerBreakdown) {
      params.append('passengerBreakdown', JSON.stringify(options.passengerBreakdown));
    }

    const url = `/api/duffel-sweep?${params.toString()}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    flushIntervalRef.current = setInterval(flushBuffers, BATCH_INTERVAL_MS);

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
      metricsBufferRef.current = { status: 'running' };
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'metrics':
            metricsBufferRef.current = {
              totalScanned: message.data.totalScanned,
              candidatesFound: message.data.candidatesFound,
              outOfRange: message.data.outOfRange,
            };
            break;

          case 'log':
            logBufferRef.current.push({
              level: message.data.level,
              message: message.data.message,
            });
            if (logBufferRef.current.length > 200) {
              logBufferRef.current = logBufferRef.current.slice(-200);
            }
            break;

          case 'candidate':
            candidateBufferRef.current.push(message.data);
            if (candidateBufferRef.current.length > 5000) {
              candidateBufferRef.current = candidateBufferRef.current.slice(-5000);
            }
            break;

          case 'complete':
            flushBuffers();
            setMetrics({
              status: 'completed',
              totalScanned: message.data.totalScanned,
              candidatesFound: message.data.candidatesFound,
              outOfRange: message.data.outOfRange,
            });
            addLog({
              level: 'success',
              message: `Sweep completed: ${message.data.candidatesFound} candidates found`,
            });
            eventSource.close();
            if (flushIntervalRef.current) {
              clearInterval(flushIntervalRef.current);
              flushIntervalRef.current = null;
            }
            setIsConnected(false);
            options.onComplete?.();
            break;

          case 'error':
            flushBuffers();
            setError(message.data.message);
            setMetrics({ status: 'error' });
            addLog({
              level: 'error',
              message: `Error: ${message.data.message}`,
            });
            eventSource.close();
            if (flushIntervalRef.current) {
              clearInterval(flushIntervalRef.current);
              flushIntervalRef.current = null;
            }
            setIsConnected(false);
            options.onError?.(message.data.message);
            break;
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      flushBuffers();
      setError('Connection lost');
      setMetrics({ status: 'error' });
      addLog({
        level: 'error',
        message: 'SSE connection error',
      });
      eventSource.close();
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }
      setIsConnected(false);
    };
  };

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    flushBuffers();
    setIsConnected(false);
    setMetrics({ status: 'aborted' });
    addLog({
      level: 'warning',
      message: 'Sweep manually aborted',
    });
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
      }
    };
  }, []);

  return {
    connect,
    disconnect,
    isConnected,
    error,
  };
}
