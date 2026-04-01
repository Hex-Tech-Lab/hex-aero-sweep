'use client';

import { useEffect, useState } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/MetricCard';
import { TerminalOutput } from '@/components/TerminalOutput';
import { FlightDataTable } from '@/components/FlightDataTable';
import { VolatilityChart } from '@/components/VolatilityChart';
import { HeuristicPathChart } from '@/components/HeuristicPathChart';
import { Badge } from '@/components/ui/badge';
import { Play, Square, ChevronLeft, Database } from 'lucide-react';
import { toast } from 'sonner';

export function ExecutionStep({ onBack }: { onBack: () => void }) {
  const {
    ticket,
    config,
    metrics,
    setMetrics,
    clearLogs,
    clearFlightResults,
    addLog,
    sweepExecutionId,
  } = useTicketStore();

  const { addLog: addTelemetryLog } = useTelemetryStore();
  const { connect, disconnect, isConnected } = useSSEStream();
  const [hasStarted, setHasStarted] = useState(false);

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
      baseCost: ticket.baseCost,
      passengers: ticket.passengers.length,
      // Rebooking mode preferences
      directFlightOnly: config.directFlightOnly,
      outboundTimePreference: config.outboundTimePreference,
      inboundTimePreference: config.inboundTimePreference,
      // Passenger breakdown for child discount verification
      passengerBreakdown: ticket.passengerBreakdown,
    };

    addTelemetryLog({
      source: 'DUFFEL',
      type: 'REQUEST',
      message: `Initiating Duffel sweep - Session: ${sweepExecutionId}`,
      payload: sweepParams
    });

    connect({
      ...sweepParams,
      onComplete: () => {
        addTelemetryLog({
          source: 'DUFFEL',
          type: 'RESPONSE',
          message: 'Duffel sweep completed successfully',
          payload: { sessionId: sweepExecutionId, metrics }
        });
        toast.success('Sweep completed successfully');
      },
      onError: (error) => {
        addTelemetryLog({
          source: 'DUFFEL',
          type: 'ERROR',
          message: `Duffel sweep failed: ${error}`,
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
      case 'running':
        return 'default';
      case 'completed':
        return 'secondary';
      case 'error':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-full mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge variant={getStatusBadgeVariant()} className="uppercase text-xs">
                <Database className="w-3 h-3 mr-1" />
                {metrics.status === 'idle' ? 'DB SYNC: STABLE' : `STATUS: ${metrics.status}`}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              {!hasStarted || metrics.status === 'completed' || metrics.status === 'error' ? (
                <Button
                  onClick={handleStart}
                  disabled={isConnected}
                  size="sm"
                  className="bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  <Play className="w-3 h-3 mr-2" />
                  {hasStarted ? 'Re-run Sweep' : 'Initialize Sweep'}
                </Button>
              ) : (
                <Button
                  onClick={handleStop}
                  disabled={!isConnected}
                  variant="destructive"
                  size="sm"
                >
                  <Square className="w-3 h-3 mr-2" />
                  Abort Sweep
                </Button>
              )}

              <Button variant="outline" size="sm" onClick={onBack} disabled={isConnected}>
                <ChevronLeft className="w-3 h-3 mr-2" />
                Back
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-full mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            label="Total Scanned"
            value={metrics.totalScanned}
            variant="default"
          />
          <MetricCard
            label="Candidates"
            value={metrics.candidatesFound}
            variant="success"
          />
          <MetricCard
            label="Out of Range"
            value={metrics.outOfRange}
            variant="error"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <VolatilityChart />
          <HeuristicPathChart />
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
              Verified Rebooking Candidates
            </h3>
            <FlightDataTable />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
              Terminal Output Stream
            </h3>
            <div className="border border-slate-800 rounded-sm bg-slate-900 overflow-hidden">
              <TerminalOutput />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
