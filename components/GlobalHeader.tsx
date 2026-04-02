'use client';

import { useRouter } from 'next/navigation';
import { Plane, Loader2 } from 'lucide-react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square, ChevronLeft, Database } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type HeaderMode = 'wizard' | 'execution';

type GlobalHeaderProps = {
  mode?: HeaderMode;
  onBack?: () => void;
};

export function GlobalHeader({ mode = 'wizard', onBack }: GlobalHeaderProps) {
  const router = useRouter();
  const resetStore = useTicketStore((state) => state.resetStore);
  const { ticket, config, metrics, setMetrics, clearLogs, clearFlightResults, addLog, sweepExecutionId } = useTicketStore();
  const { addLog: addTelemetryLog } = useTelemetryStore();
  const { connect, disconnect, isConnected } = useSSEStream();
  const [hasStarted, setHasStarted] = useState(false);

  const handleLogoClick = () => {
    resetStore();
    router.push('/');
  };

  const handleStart = () => {
    if (!ticket.issueDate || !config.searchWindowStart || !config.searchWindowEnd) {
      toast.error('Invalid configuration');
      return;
    }

    if (!sweepExecutionId) {
      toast.error('No session ID found');
      return;
    }

    clearLogs();
    clearFlightResults();
    setMetrics({ totalScanned: 0, candidatesFound: 0, outOfRange: 0, status: 'running' });

    addLog({
      level: 'info',
      message: '[SYSTEM] Initializing sweep orchestrator...',
    });

    const sweepParams = {
      sessionId: sweepExecutionId,
      searchWindowStart: new Date(config.searchWindowStart).toISOString().split('T')[0],
      searchWindowEnd: new Date(config.searchWindowEnd).toISOString().split('T')[0],
      minNights: config.minNights,
      maxNights: config.maxNights,
      priceTolerance: config.priceTolerance,
      maxApiCalls: config.maxApiCalls,
      baseCost: (ticket as any).baseFare || ticket.baseCost || 792.87,
      passengers: ticket.passengers.length,
      directFlightOnly: config.directFlightOnly,
      outboundTimePreference: config.outboundTimePreference,
      inboundTimePreference: config.inboundTimePreference,
      passengerBreakdown: ticket.passengerBreakdown,
    };

    addTelemetryLog({
      source: 'DUFFEL',
      type: 'REQUEST',
      message: `Initiating Provider sweep - Session: ${sweepExecutionId}`,
      payload: sweepParams
    });

    connect({
      ...sweepParams,
      onComplete: () => {
        addTelemetryLog({
          source: 'DUFFEL',
          type: 'RESPONSE',
          message: 'Provider sweep completed successfully',
          payload: { sessionId: sweepExecutionId, metrics }
        });
        toast.success('Sweep completed successfully');
      },
      onError: (error) => {
        addTelemetryLog({
          source: 'DUFFEL',
          type: 'ERROR',
          message: `Provider sweep failed: ${error}`,
          payload: { sessionId: sweepExecutionId, error }
        });
        toast.error(`Sweep failed: ${error}`);
      },
    });

    setHasStarted(true);
  };

  const handleStop = () => {
    disconnect();
    toast.warning('Sweep aborted');
  };

  const getStatusBadgeVariant = () => {
    switch (metrics.status) {
      case 'running': return 'default';
      case 'completed': return 'secondary';
      case 'error': return 'destructive';
      default: return 'outline';
    }
  };

  const isRunning = metrics.status === 'running' && isConnected;

  return (
    <header className="border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-full mx-auto px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleLogoClick}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
            >
              <div className="relative">
                <motion.div
                  className="absolute inset-0"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                >
                  <svg className="w-7 h-7" viewBox="0 0 32 32" fill="none">
                    <path
                      d="M16 4 A12 12 0 0 1 28 16"
                      stroke="#06b6d4"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      opacity="0.6"
                    />
                  </svg>
                </motion.div>
                <Plane className="w-5 h-5 text-cyan-400" />
                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-slate-100">
                  AEROSWEEP <span className="text-cyan-400">v4.0</span>
                </h1>
                <p className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">
                  Aviation Pricing Intelligence
                </p>
              </div>
            </button>

            {mode === 'execution' && (
              <div className="flex items-center gap-2">
                <Badge variant={getStatusBadgeVariant()} className="uppercase text-[10px]">
                  <Database className="w-3 h-3 mr-1" />
                  {metrics.status === 'idle' ? 'DB SYNC: STABLE' : `STATUS: ${metrics.status}`}
                </Badge>
                {isRunning && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Loader2 className="w-4 h-4 text-cyan-400" />
                  </motion.div>
                )}
              </div>
            )}
          </div>

          {mode === 'execution' && (
            <div className="flex items-center gap-2">
              {!hasStarted || metrics.status === 'completed' || metrics.status === 'error' ? (
                <Button
                  onClick={handleStart}
                  disabled={isConnected}
                  size="sm"
                  className="bg-cyan-600 hover:bg-cyan-700 text-white h-7 text-xs"
                >
                  <Play className="w-3 h-3 mr-1.5" />
                  {hasStarted ? 'Re-run' : 'Initialize Sweep'}
                </Button>
              ) : (
                <Button
                  onClick={handleStop}
                  disabled={!isConnected}
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Loader2 className="w-3 h-3 mr-1.5" />
                  </motion.div>
                  Abort Sweep
                </Button>
              )}

              <Button variant="outline" size="sm" onClick={onBack} disabled={isConnected} className="h-7 text-xs">
                <ChevronLeft className="w-3 h-3 mr-1.5" />
                Back
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

import { useState } from 'react';
