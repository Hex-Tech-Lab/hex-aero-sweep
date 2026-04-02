'use client';

import { useEffect, useRef } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TerminalOutput() {
  const { logs, clearLogs } = useTicketStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { isVisible: telemetryVisible } = useTelemetryStore();

  useEffect(() => {
    if (bottomRef.current && scrollContainerRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [logs]);

  const logColorClass: Record<string, string> = {
    info: 'text-cyan-400',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
  };

  const heightClass = telemetryVisible ? 'h-44' : 'h-40';

  return (
    <div className={cn("flex flex-col overflow-hidden bg-slate-950", heightClass)}>
      <div className="flex items-center justify-between p-1.5 border-b border-slate-800 shrink-0 bg-slate-950">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-[9px] text-slate-600 uppercase tracking-wide font-medium">
            Output
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-700">
            {logs.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            className="h-4 px-1"
          >
            <X className="w-2.5 h-2.5" />
          </Button>
        </div>
      </div>

      <div className="max-h-[300px] overflow-y-auto p-1 bg-slate-950">
        <div ref={scrollContainerRef}>
          {logs.length === 0 ? (
            <div className="text-slate-700 text-center py-2 text-[9px] uppercase tracking-wider font-mono">
              READY...
            </div>
          ) : (
            <>
              {logs.map((log) => (
                <div key={log.id} className="mb-0.5 flex gap-1.5 px-1 py-0.5 text-[9px] font-mono">
                  <span className="text-slate-700 shrink-0">
                    [{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                  </span>
                  <span className={cn(logColorClass[log.level] || 'text-slate-500', 'whitespace-pre-wrap break-all')}>
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
