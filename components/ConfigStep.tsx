'use client';

import { useState } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DatePicker } from '@/components/ui/date-picker';
import { ChevronRight, ChevronLeft, TriangleAlert as AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { createSearchLog } from '@/lib/supabase-operations';

export function ConfigStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { ticket, config, setConfig, isConfigValid, isTicketExpired, setSweepExecutionId } = useTicketStore();
  const { addLog } = useTelemetryStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isTicketExpired()) {
      toast.error('Ticket has expired');
      return;
    }

    if (!isConfigValid()) {
      toast.error('Please fill in all required fields with valid values');
      return;
    }

    setIsSubmitting(true);

    const startTime = Date.now();

    try {
      const sessionId = `sweep_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const totalPassengers = ticket.passengers.adults + ticket.passengers.children;

      const searchConfig = {
        session_id: sessionId,
        pnr: ticket.pnr,
        passengers_count: totalPassengers,
        fare_class: ticket.fareClass,
        base_cost: ticket.baseCost,
        date_range_from: config.searchWindowStart!.toISOString().split('T')[0],
        date_range_to: config.searchWindowEnd!.toISOString().split('T')[0],
        target_duration_min: config.minNights,
        target_duration_max: config.maxNights,
        max_price_diff: config.priceTolerance,
        api_calls_used: 0,
        results_found: 0,
        status: 'pending' as const,
      };

      addLog({
        source: 'SYSTEM',
        type: 'REQUEST',
        message: `Creating search log for session: ${sessionId}`,
        payload: searchConfig
      });

      await createSearchLog(searchConfig);

      const latency = Date.now() - startTime;

      addLog({
        source: 'SYSTEM',
        type: 'RESPONSE',
        message: `Search log created successfully - Session: ${sessionId}`,
        payload: { sessionId },
        latency
      });

      setSweepExecutionId(sessionId);
      onNext();
    } catch (error) {
      const latency = Date.now() - startTime;

      addLog({
        source: 'SYSTEM',
        type: 'ERROR',
        message: 'Failed to create search log',
        payload: { error: error instanceof Error ? error.message : String(error) },
        latency
      });

      console.error('Failed to create search log:', error);
      toast.error('Failed to initialize sweep. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const maxSelectableDate = ticket.expirationDate
    ? new Date(ticket.expirationDate).toISOString().split('T')[0]
    : '';

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-100 mb-1">
          CONFIGURATION PARAMETERS
        </h2>
        <p className="text-xs text-slate-500">
          IATA rebooking boundaries & heuristic filtering
        </p>
      </div>

      {isTicketExpired() && (
        <Alert variant="destructive" className="mb-4 border-red-900 bg-red-950/30">
          <AlertTriangle className="h-3 w-3" />
          <AlertDescription className="text-xs">
            <strong>CIRCUIT BREAKER:</strong> Ticket expired on{' '}
            {ticket.expirationDate?.toISOString().split('T')[0]}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Card className="p-4 border-slate-800 bg-slate-900/50 space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Search Window
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="searchWindowStart" className="text-slate-400 text-xs mb-1">
                  Window Start *
                </Label>
                <DatePicker
                  date={config.searchWindowStart}
                  onSelect={(date) => setConfig({ searchWindowStart: date || null })}
                  minDate={new Date()}
                  maxDate={ticket.expirationDate || undefined}
                  placeholder="Select start date"
                  className="text-xs h-9"
                />
              </div>

              <div>
                <Label htmlFor="searchWindowEnd" className="text-slate-400 text-xs mb-1">
                  Window End *
                </Label>
                <DatePicker
                  date={config.searchWindowEnd}
                  onSelect={(date) => setConfig({ searchWindowEnd: date || null })}
                  minDate={
                    config.searchWindowStart
                      ? new Date(config.searchWindowStart.getTime() + 24 * 60 * 60 * 1000)
                      : new Date(new Date().getTime() + 24 * 60 * 60 * 1000)
                  }
                  maxDate={ticket.expirationDate || undefined}
                  placeholder="Select end date"
                  className="text-xs h-9"
                />
              </div>
            </div>
            <p className="text-[10px] text-yellow-500 mt-1 font-mono">
              LOCKED TO TICKET EXPIRY: {maxSelectableDate}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Trip Duration
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="minNights" className="text-slate-400 text-xs mb-1">
                  Min Nights *
                </Label>
                <Input
                  id="minNights"
                  type="number"
                  min="1"
                  max="30"
                  value={config.minNights}
                  onChange={(e) =>
                    setConfig({ minNights: parseInt(e.target.value) || 1 })
                  }
                  required
                  className="bg-slate-950 border-slate-800 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="maxNights" className="text-slate-400 text-xs mb-1">
                  Max Nights *
                </Label>
                <Input
                  id="maxNights"
                  type="number"
                  min="1"
                  max="30"
                  value={config.maxNights}
                  onChange={(e) =>
                    setConfig({ maxNights: parseInt(e.target.value) || 14 })
                  }
                  required
                  className="bg-slate-950 border-slate-800 text-xs"
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Circuit Breakers
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="priceTolerance" className="text-slate-400 text-xs mb-1">
                  Target Price Delta ($) *
                </Label>
                <Input
                  id="priceTolerance"
                  type="number"
                  min="0"
                  step="0.01"
                  value={config.priceTolerance}
                  onChange={(e) =>
                    setConfig({ priceTolerance: parseFloat(e.target.value) || 0 })
                  }
                  required
                  className="bg-slate-950 border-slate-800 text-xs"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Max acceptable price difference
                </p>
              </div>

              <div>
                <Label htmlFor="maxApiCalls" className="text-slate-400 text-xs mb-1">
                  Max API Calls *
                </Label>
                <Input
                  id="maxApiCalls"
                  type="number"
                  min="1"
                  max="500"
                  value={config.maxApiCalls}
                  onChange={(e) =>
                    setConfig({ maxApiCalls: parseInt(e.target.value) || 100 })
                  }
                  required
                  className="bg-slate-950 border-slate-800 text-xs"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Sweep termination threshold
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-between mt-4">
          <Button type="button" variant="outline" onClick={onBack} className="text-xs">
            <ChevronLeft className="w-3 h-3 mr-2" />
            Back
          </Button>
          <Button
            type="submit"
            disabled={!isConfigValid() || isTicketExpired() || isSubmitting}
            className="px-6 text-xs"
          >
            {isSubmitting ? 'Initializing...' : 'Orchestrate Sweep'}
            <ChevronRight className="w-3 h-3 ml-2" />
          </Button>
        </div>
      </form>
    </div>
  );
}
