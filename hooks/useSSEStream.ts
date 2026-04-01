import { useEffect, useRef, useState } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';

type SSEMessage = {
  type: 'metrics' | 'log' | 'candidate' | 'complete' | 'error';
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
  onComplete?: () => void;
  onError?: (error: string) => void;
};

export function useSSEStream() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { setMetrics, addLog, addFlightResult } = useTicketStore();

  const connect = (options: UseSSEStreamOptions) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const params = new URLSearchParams({
      sessionId: options.sessionId,
      searchWindowStart: options.searchWindowStart,
      searchWindowEnd: options.searchWindowEnd,
      minNights: options.minNights.toString(),
      maxNights: options.maxNights.toString(),
      priceTolerance: options.priceTolerance.toString(),
      maxApiCalls: options.maxApiCalls.toString(),
      baseCost: options.baseCost.toString(),
    });

    const url = `/api/duffel-sweep?${params.toString()}`;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
      setMetrics({ status: 'running' });
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'metrics':
            setMetrics({
              totalScanned: message.data.totalScanned,
              candidatesFound: message.data.candidatesFound,
              outOfRange: message.data.outOfRange,
            });
            break;

          case 'log':
            addLog({
              level: message.data.level,
              message: message.data.message,
            });
            break;

          case 'candidate':
            addFlightResult(message.data);
            break;

          case 'complete':
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
            setIsConnected(false);
            options.onComplete?.();
            break;

          case 'error':
            setError(message.data.message);
            setMetrics({ status: 'error' });
            addLog({
              level: 'error',
              message: `Error: ${message.data.message}`,
            });
            eventSource.close();
            setIsConnected(false);
            options.onError?.(message.data.message);
            break;
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      setError('Connection lost');
      setMetrics({ status: 'error' });
      addLog({
        level: 'error',
        message: 'SSE connection error',
      });
      eventSource.close();
      setIsConnected(false);
    };
  };

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
      setMetrics({ status: 'aborted' });
      addLog({
        level: 'warning',
        message: 'Sweep manually aborted',
      });
    }
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
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
