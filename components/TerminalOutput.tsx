'use client';

import { useEffect, useRef } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TerminalOutput() {
  const { logs, clearLogs } = useTicketStore();
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const logColorClass = {
    info: 'terminal-log-info',
    success: 'terminal-log-success',
    warning: 'terminal-log-warning',
    error: 'terminal-log-error',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs text-slate-500 uppercase tracking-wide font-medium ml-2">
            Terminal Output
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">
            Buffer: {logs.length}/500
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            className="h-6 px-2"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div
        ref={terminalRef}
        className="terminal-output flex-1"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 text-center py-4">
            READY FOR HANDSHAKE...
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="mb-1 flex gap-2">
              <span className="text-slate-600 shrink-0">
                [{log.timestamp.toLocaleTimeString()}]
              </span>
              <span className={cn(logColorClass[log.level])}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
