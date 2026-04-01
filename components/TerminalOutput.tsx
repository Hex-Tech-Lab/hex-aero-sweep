'use client';

import { useEffect, useRef } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TerminalOutput() {
  const { logs, clearLogs } = useTicketStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { isVisible: telemetryVisible } = useTelemetryStore();

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const logColorClass: Record<string, string> = {
    info: 'text-cyan-400',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
  };

  const heightClass = telemetryVisible ? 'h-48' : 'h-44';

  return (
    <div className={cn("flex flex-col overflow-hidden", heightClass)}>
      <div className="flex items-center justify-between p-2 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium ml-1">
            Output
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-600">
            {logs.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            className="h-5 px-1.5"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto p-1"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 text-center py-3 text-[10px] uppercase tracking-wider">
            READY FOR HANDSHAKE...
          </div>
        ) : (
          <>
            {logs.map((log) => (
              <div key={log.id} className="mb-0.5 flex gap-2 px-1 py-0.5 text-[10px]">
                <span className="text-slate-600 shrink-0 font-mono">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                <span className={cn(logColorClass[log.level] || 'text-slate-400')}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
