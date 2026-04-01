'use client';

import { useState, useCallback } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { syncPNRDetails } from '@/lib/duffel-service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DatePicker } from '@/components/ui/date-picker';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronLeft, TriangleAlert as AlertTriangle, Plane, UserCheck, Baby } from 'lucide-react';
import { toast } from 'sonner';
import { createSearchLog } from '@/lib/supabase-operations';

export function ConfigStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passengerTypes, setPassengerTypes] = useState<Record<number, 'adult' | 'child' | 'infant'>>({});
  const { ticket, config, setConfig, setTicket, isConfigValid, isTicketExpired, isRebookingMode, setSweepExecutionId } = useTicketStore();
  const { addLog } = useTelemetryStore();

  const getPassengerType = (index: number): 'adult' | 'child' | 'infant' => {
    return passengerTypes[index] || 'adult';
  };

  const handlePassengerTypeChange = useCallback((index: number, type: 'adult' | 'child' | 'infant') => {
    setPassengerTypes(prev => ({ ...prev, [index]: type }));
    
    const breakdown = ticket.passengerBreakdown || {};
    const counts = { adults: 0, children: 0, infants: 0 };
    
    const updatedTypes = { ...passengerTypes, [index]: type };
    Object.values(updatedTypes).forEach(t => {
      counts[t === 'adult' ? 'adults' : t === 'child' ? 'children' : 'infants']++;
    });

    setTicket({
      passengerBreakdown: {
        ...breakdown,
        ...counts,
        manualOverride: true,
        passengerTypeSource: 'MANUAL_VERIFICATION',
      }
    });
  }, [passengerTypes, ticket.passengerBreakdown, setTicket]);

  const handleSyncFromPNR = useCallback(async () => {
    if (!ticket.pnr) {
      toast.error('PNR not found - sync skipped');
      return;
    }

    addLog({
      source: 'SYSTEM',
      type: 'REQUEST',
      message: `Syncing passenger details from PNR: ${ticket.pnr}`,
      payload: { pnr: ticket.pnr, lastName: ticket.primaryPassengerLastName }
    });

    const result = await syncPNRDetails(ticket.pnr, ticket.primaryPassengerLastName);

    if (result.success && result.data) {
      toast.success('PNR sync successful');
      addLog({
        source: 'SYSTEM',
        type: 'RESPONSE',
        message: 'PNR details synced successfully',
        payload: result.data
      });
    } else {
      toast.warning('PNR sync returned no data - using manual verification');
      addLog({
        source: 'SYSTEM',
        type: 'INFO',
        message: result.error || 'PNR sync returned empty - fallback to manual verification',
        payload: result
      });
    }
  }, [ticket.pnr, ticket.primaryPassengerLastName, addLog]);

  const isManualOverride = ticket.passengerBreakdown?.manualOverride === true;
  const passengerCount = ticket.passengers?.length || 0;
  const noMarkerFound = !ticket.passengerBreakdown?.passengerTypeSource || ticket.passengerBreakdown?.passengerTypeSource === 'NO_MARKER_FOUND';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Allow submission in rebooking mode even if ticket is expired
    if (isTicketExpired() && !isRebookingMode()) {
      toast.error('Ticket has expired');
      return;
    }

    if (!isConfigValid()) {
      toast.error('Please fill in all required fields with valid values');
      return;
    }

    setIsSubmitting(true);

    const startTime = Date.now();
    const sessionId = `sweep_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const totalPassengers = ticket.passengers.length;

    const searchConfig = {
      session_id: sessionId,
      pnr: ticket.pnr,
      passengers_count: ticket.passengers.length,
      fare_class: ticket.fareClass,
      base_cost: ticket.baseCost,
      date_range_from: config.searchWindowStart ? new Date(config.searchWindowStart).toISOString().split('T')[0] : '',
      date_range_to: config.searchWindowEnd ? new Date(config.searchWindowEnd).toISOString().split('T')[0] : '',
      target_duration_min: config.minNights,
      target_duration_max: config.maxNights,
      max_price_diff: config.priceTolerance,
      api_calls_used: 0,
      results_found: 0,
      status: 'pending' as const,
      rebooking_mode: rebookingActive,
      direct_flight_only: config.directFlightOnly,
      outbound_time_preference: config.outboundTimePreference,
      inbound_time_preference: config.inboundTimePreference,
    };

    try {
      addLog({
        source: 'SYSTEM',
        type: 'REQUEST',
        message: `Creating search log for session: ${sessionId}`,
        payload: searchConfig
      });

      try {
        await createSearchLog(searchConfig);
        addLog({
          source: 'SYSTEM',
          type: 'RESPONSE',
          message: `Search log created successfully - Session: ${sessionId}`,
          payload: { sessionId },
          latency: Date.now() - startTime
        });
      } catch (dbError) {
        console.warn('[DB] Search log insert failed - continuing without telemetry:', dbError);
        addLog({
          source: 'SYSTEM',
          type: 'INFO',
          message: 'Search log DB insert failed - proceeding without persistence',
          payload: { sessionId, dbError: dbError instanceof Error ? dbError.message : String(dbError) }
        });
      }

      setSweepExecutionId(sessionId);
      onNext();
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorObj = error instanceof Error ? error : new Error(String(error));

      console.error('=== CONFIGSTEP CRITICAL ERROR ===');
      console.error('Message:', errorObj.message);
      console.error('Stack:', errorObj.stack);
      console.error('=====================================');
      
      addLog({
        source: 'SYSTEM',
        type: 'ERROR',
        message: 'Critical error during initialization',
        payload: { 
          error: errorObj.message, 
          sessionId,
          searchConfig
        },
        latency
      });
      
      toast.error('Failed to initialize sweep. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const expirationDate = ticket.expirationDate ? new Date(ticket.expirationDate) : null;
  const isValidExpiration = expirationDate && !isNaN(expirationDate.getTime());
  const maxSelectableDate = isValidExpiration ? expirationDate!.toISOString().split('T')[0] : '';

  const today = new Date().toISOString().split('T')[0];

  // Rebooking mode: original departure is in the past
  const rebookingActive = isRebookingMode();

  // For rebooking mode: allow dates up to end of 2026, otherwise use expiration date
  const rebookingMaxDate = '2026-12-31';
  const effectiveMaxDate = rebookingActive ? rebookingMaxDate : maxSelectableDate;

  // Minimum date: for rebooking mode use today, for normal mode use today
  const effectiveMinDate = today;

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

      {/* REBOOKING MODE Alert */}
      {rebookingActive && (
        <Alert className="mb-4 border-amber-600 bg-amber-950/30">
          <Plane className="h-3 w-3 text-amber-500" />
          <AlertDescription className="text-xs text-amber-200">
            <strong className="text-amber-400">REBOOKING MODE:</strong> Original departure was in the past. Search Window is configured for future travel dates in 2026.
          </AlertDescription>
        </Alert>
      )}

      {isRebookingMode() && (
        <Alert variant="warning" className="mb-4 border-amber-600 bg-amber-950/30">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <AlertDescription className="text-xs text-amber-200">
            <strong className="text-amber-400">REBOOKING OVERRIDE:</strong> Original ticket expiration is bypassed for future search.
          </AlertDescription>
        </Alert>
      )}

      {(isTicketExpired() || !isValidExpiration) && !isRebookingMode() && (
        <Alert variant="destructive" className="mb-4 border-red-900 bg-red-950/30">
          <AlertTriangle className="h-3 w-3" />
          <AlertDescription className="text-xs">
            <strong>CIRCUIT BREAKER:</strong> Ticket expired on{' '}
            {!isValidExpiration ? 'No Expiry Found - Defaulting to 1 Year' : expirationDate!.toISOString().split('T')[0]}
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
                  minDate={new Date(effectiveMinDate)}
                  maxDate={effectiveMaxDate ? new Date(effectiveMaxDate) : undefined}
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
                      ? new Date(new Date(config.searchWindowStart).getTime() + 24 * 60 * 60 * 1000)
                      : new Date(effectiveMinDate + 'T00:00:00')
                  }
                  maxDate={effectiveMaxDate ? new Date(effectiveMaxDate) : undefined}
                  placeholder="Select end date"
                  className="text-xs h-9"
                />
              </div>
            </div>
            {rebookingActive ? (
              <p className="text-[10px] text-amber-500 mt-1 font-mono">
                REBOOKING MODE: Search Window set for future travel in 2026
              </p>
            ) : (
              <p className="text-[10px] text-slate-500 mt-1">
                Original Ticket Valid: Search Window within expiration period
              </p>
            )}
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

          {/* Preference Toggles */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Flight Preferences
            </h3>
            <div className="space-y-3">
              {/* Direct Flight Only Toggle */}
              <div className="flex items-center justify-between p-3 border border-slate-800 bg-slate-950/30 rounded-md">
                <div className="flex flex-col">
                  <Label htmlFor="directFlightOnly" className="text-slate-300 text-xs font-medium">
                    Direct Flight Only
                  </Label>
                  <span className="text-[10px] text-slate-500">
                    Exclude flights with connections
                  </span>
                </div>
                <Switch
                  id="directFlightOnly"
                  checked={config.directFlightOnly}
                  onCheckedChange={(checked) => setConfig({ directFlightOnly: checked })}
                />
              </div>

              {/* Outbound Time Preference */}
              <div className="p-3 border border-slate-800 bg-slate-950/30 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="outboundTimePreference" className="text-slate-300 text-xs font-medium">
                    Outbound Time Preference
                  </Label>
                </div>
                <select
                  id="outboundTimePreference"
                  value={config.outboundTimePreference}
                  onChange={(e) => setConfig({ outboundTimePreference: e.target.value as any })}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-md px-3 py-2"
                >
                  <option value="any">Any Time</option>
                  <option value="morning">Morning (6AM - 12PM)</option>
                  <option value="afternoon">Afternoon (12PM - 6PM)</option>
                  <option value="evening">Evening (6PM - 12AM)</option>
                </select>
              </div>

              {/* Inbound Time Preference */}
              <div className="p-3 border border-slate-800 bg-slate-950/30 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="inboundTimePreference" className="text-slate-300 text-xs font-medium">
                    Return Time Preference
                  </Label>
                </div>
                <select
                  id="inboundTimePreference"
                  value={config.inboundTimePreference}
                  onChange={(e) => setConfig({ inboundTimePreference: e.target.value as any })}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-md px-3 py-2"
                >
                  <option value="any">Any Time</option>
                  <option value="morning">Morning (6AM - 12PM)</option>
                  <option value="afternoon">Afternoon (12PM - 6PM)</option>
                  <option value="evening">Evening (6PM - 12AM)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Passenger Verification */}
          {(noMarkerFound || isManualOverride) && passengerCount > 0 && (
            <Alert variant="warning" className="mb-4 border-amber-600/50 bg-amber-950/20">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              <AlertDescription className="text-xs text-amber-200">
                <strong className="text-amber-400">PDF SILENT:</strong> Passenger types not detected. Verify manually for accurate pricing.
              </AlertDescription>
            </Alert>
          )}
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Passenger Verification
              </h3>
              {ticket.pnr && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSyncFromPNR}
                  className="h-6 px-2 text-[10px] text-cyan-400 hover:text-cyan-300"
                >
                  <UserCheck className="w-3 h-3 mr-1" />
                  Sync from PNR
                </Button>
              )}
            </div>
            <div className="space-y-2 border border-slate-800 bg-slate-950/30 rounded-md p-3">
              {ticket.passengers?.map((passenger, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-xs text-slate-300 truncate flex-1">{passenger}</span>
                  <div className="flex items-center gap-1 ml-2">
                    <Badge
                      variant={getPassengerType(index) === 'adult' ? 'default' : 'outline'}
                      className={`text-[10px] cursor-pointer ${getPassengerType(index) === 'adult' ? 'bg-cyan-600/30 text-cyan-400 border-cyan-500/50' : 'text-slate-500'}`}
                      onClick={() => handlePassengerTypeChange(index, 'adult')}
                    >
                      Adult
                    </Badge>
                    <Badge
                      variant={getPassengerType(index) === 'child' ? 'default' : 'outline'}
                      className={`text-[10px] cursor-pointer ${getPassengerType(index) === 'child' ? 'bg-amber-600/30 text-amber-400 border-amber-500/50' : 'text-slate-500'}`}
                      onClick={() => handlePassengerTypeChange(index, 'child')}
                    >
                      <Baby className="w-3 h-3 mr-0.5" />
                      Child
                    </Badge>
                    <Badge
                      variant={getPassengerType(index) === 'infant' ? 'default' : 'outline'}
                      className={`text-[10px] cursor-pointer ${getPassengerType(index) === 'infant' ? 'bg-pink-600/30 text-pink-400 border-pink-500/50' : 'text-slate-500'}`}
                      onClick={() => handlePassengerTypeChange(index, 'infant')}
                    >
                      Infant
                    </Badge>
                  </div>
                </div>
              ))}
              {passengerCount === 0 && (
                <p className="text-[10px] text-slate-500 text-center py-2">No passengers loaded</p>
              )}
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
            disabled={!isConfigValid() || (isTicketExpired() && !isRebookingMode()) || isSubmitting}
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
