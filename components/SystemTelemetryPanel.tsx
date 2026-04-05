"use client";

import { useEffect, useRef } from 'react';
import { useTelemetryStore, LogType } from '@/src/store/useTelemetryStore';
import { ChevronDown, ChevronUp, Trash2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SystemTelemetryPanel({ className }: { className?: string }) {
  const { logs, isVisible, isExpanded, toggleVisibility, clearLogs, toggleExpanded } = useTelemetryStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isVisible) return null;

  const panelHeight = isExpanded ? 'h-64' : 'h-12';
  const innerOverflow = isExpanded ? 'overflow-y-auto' : '';

  const getLogColor = (type: LogType): string => {
    switch (type) {
      case 'REQUEST':
        return 'text-cyan-400';
      case 'RESPONSE':
        return 'text-emerald-400';
      case 'ERROR':
        return 'text-red-400';
      case 'INFO':
        return 'text-yellow-400';
      default:
        return 'text-slate-400';
    }
  };

  const getSourceColor = (source: string): string => {
    switch (source) {
      case 'OPENROUTER':
        return 'text-purple-400';
      case 'DUFFEL':
        return 'text-blue-400';
      case 'SYSTEM':
        return 'text-slate-400';
      default:
        return 'text-slate-400';
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  return (
    <div className={`shrink-0 transition-[height] duration-300 ease-in-out bg-slate-900 border-t border-slate-800 ${panelHeight} ${!isExpanded ? 'overflow-hidden' : ''} ${className || ''}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono text-cyan-400 font-semibold">
            SYSTEM TELEMETRY
          </span>
          <span className="text-xs font-mono text-slate-500">
            [{logs.length} ENTRIES]
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={clearLogs}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-red-950/30"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            CLEAR
          </Button>
          <Button
            onClick={toggleExpanded}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-mono text-slate-400 hover:text-slate-300 hover:bg-slate-800"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="w-3 h-3 mr-1" />
                COLLAPSE
              </>
            ) : (
              <>
                <ChevronUp className="w-3 h-3 mr-1" />
                EXPAND
              </>
            )}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className={`flex-1 min-h-0 ${innerOverflow} p-4 font-mono text-xs space-y-2 overflow-y-auto`}>

          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-8">
              NO TELEMETRY DATA. AWAITING SYSTEM EVENTS...
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="border border-slate-800 rounded bg-slate-950/50 p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-600">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span className={`font-semibold ${getSourceColor(log.source)}`}>
                      [{log.source}]
                    </span>
                    <span className={`font-semibold ${getLogColor(log.type)}`}>
                      {log.type}
                    </span>
                    {log.latency && (
                      <span className="text-amber-400">
                        {log.latency}ms
                      </span>
                    )}
                  </div>
                </div>

                {log.message && (
                  <div className="text-slate-300 pl-2 border-l-2 border-slate-700">
                    {log.message}
                  </div>
                )}

                {log.rawResponse && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-yellow-400 hover:text-yellow-300">
                      RAW RESPONSE ▼
                    </summary>
                    <pre className="mt-2 p-2 bg-black border border-slate-800 rounded text-slate-400 overflow-x-auto text-[10px]">
                      {log.rawResponse}
                    </pre>
                  </details>
                )}

                {log.payload && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-cyan-400 hover:text-cyan-300">
                      PAYLOAD ▼
                    </summary>
                    <pre className="mt-2 p-2 bg-black border border-slate-800 rounded text-slate-400 overflow-x-auto text-[10px]">
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))
          )}
      </div>
    </div>
  );
}
