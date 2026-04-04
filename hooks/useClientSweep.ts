import { useCallback, useRef } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';

const CHUNK_SIZE = 3;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

export function useClientSweep() {
  const abortRef = useRef(false);
  
  const {
    ticket,
    config,
    setMetrics,
    addLog,
    addFlightResult,
    clearLogs,
    clearFlightResults,
  } = useTicketStore();
  
  const { addLog: addTelemetryLog } = useTelemetryStore();

  const runSweep = useCallback(async () => {
    abortRef.current = false;
    
    const baseCost = ticket.baseCost || 792.87;
    const maxAcceptablePrice = baseCost + config.priceTolerance;
    let totalApiCalls = 0;
    let totalScanned = 0;
    let candidatesFound = 0;
    let outOfRange = 0;
    
    clearLogs();
    clearFlightResults();
    setMetrics({ totalScanned: 0, candidatesFound: 0, outOfRange: 0, status: 'running' });
    
    addLog({ level: 'info', message: '[SYSTEM] AEROSWEEP v7.0 CLIENT ORCHESTRATOR ONLINE' });
    addLog({ level: 'info', message: `[SYSTEM] Budget: ${config.maxApiCalls} API calls` });
    
    if (!config.searchWindowStart || !config.searchWindowEnd) {
      addLog({ level: 'error', message: '[SYSTEM] Search window not configured' });
      return { totalApiCalls: 0, totalScanned: 0, candidatesFound: 0 };
    }
    
    const startDate = new Date(config.searchWindowStart);
    const endDate = new Date(config.searchWindowEnd);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const searches: { departureDate: string; returnDate: string }[] = [];
    const searchSignatures = new Set<string>();
    
    for (let d = 0; d <= totalDays && searches.length < config.maxApiCalls; d++) {
      const depDate = addDays(startDate, d);
      for (let nights = config.minNights; nights <= config.maxNights && searches.length < config.maxApiCalls; nights++) {
        const retDate = addDays(depDate, nights);
        if (retDate <= endDate) {
          const depStr = depDate.toISOString().split('T')[0];
          const retStr = retDate.toISOString().split('T')[0];
          const sig = `${depStr}_${retStr}`;
          
          if (!searchSignatures.has(sig)) {
            searchSignatures.add(sig);
            searches.push({ departureDate: depStr, returnDate: retStr });
          }
        }
      }
    }
    
    addLog({ level: 'info', message: `[SYSTEM] Generated ${searches.length} unique searches` });
    
    const chunks = chunkArray(searches, CHUNK_SIZE);
    addLog({ level: 'info', message: `[SYSTEM] Processing in ${chunks.length} chunks of ${CHUNK_SIZE}` });
    
    for (let i = 0; i < chunks.length && !abortRef.current; i++) {
      const chunk = chunks[i];
      
      try {
        const res = await fetch('/api/duffel-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searches: chunk,
            origin: 'CAI',
            destination: 'ATH',
            cabinClass: 'economy',
            passengerCount: ticket.passengers.length,
            baseCost,
            priceTolerance: config.priceTolerance,
            originalCarrier: 'A3',
            directFlightOnly: config.directFlightOnly,
          }),
        });
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        
        const data = await res.json();
        
        for (const result of data.results) {
          totalApiCalls++;
          totalScanned += result.rawOffersCount;
          outOfRange += result.rejectedCount;
          
          for (const candidate of result.candidates) {
            candidatesFound++;
            addLog({
              level: 'success',
              message: `[MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`,
            } as any);
            addFlightResult(candidate);
          }
        }
        
        setMetrics({
          totalScanned,
          candidatesFound,
          outOfRange,
          status: 'running',
          progress: `${totalApiCalls}/${config.maxApiCalls}`,
          apiCallsMade: totalApiCalls,
          maxApiCalls: config.maxApiCalls,
        });
        
        addLog({
          level: 'info',
          message: `[CHUNK ${i + 1}/${chunks.length}] ${chunk.length} searches, ${data.results.reduce((sum: number, r: any) => sum + r.candidates.length, 0)} candidates`,
        });
        
        await new Promise(r => setTimeout(r, 100));
        
      } catch (err) {
        addLog({
          level: 'error',
          message: `[CHUNK ERROR] ${err instanceof Error ? err.message : 'Unknown'}`,
        });
      }
      
      if (abortRef.current) {
        addLog({ level: 'warning', message: '[SYSTEM] Sweep aborted by user' });
        break;
      }
    }
    
    setMetrics({
      totalScanned,
      candidatesFound,
      outOfRange,
      status: abortRef.current ? 'aborted' : 'completed',
      progress: `${totalApiCalls}/${config.maxApiCalls}`,
      apiCallsMade: totalApiCalls,
      maxApiCalls: config.maxApiCalls,
    });
    
    addLog({
      level: 'success',
      message: `[COMPLETE] API Calls: ${totalApiCalls} | Scanned: ${totalScanned} | Matches: ${candidatesFound}`,
    });
    
    addTelemetryLog({
      source: 'SYSTEM',
      type: 'RESPONSE',
      message: `Sweep ${abortRef.current ? 'aborted' : 'completed'}`,
      payload: { totalApiCalls, totalScanned, candidatesFound },
    });
    
    return { totalApiCalls, totalScanned, candidatesFound };
    
  }, [ticket, config, setMetrics, addLog, addFlightResult, clearLogs, clearFlightResults, addTelemetryLog]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { runSweep, abort };
}
