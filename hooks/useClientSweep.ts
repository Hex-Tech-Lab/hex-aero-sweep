import { useCallback, useRef } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import type { FlightResult } from '@/src/store/useTicketStore';
import { createSearchJob, updateSearchJob } from '@/lib/supabase';
import { loadFareFamilyCache, bulkInsertSearchResults, upsertPriceCalendar } from '@/lib/airline-intelligence';
import type { FareFamilyCache, FareFamilyRow } from '@/types/airline';

const CHUNK_SIZE = 4;

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

// UCB1 scoring for exploration/exploitation balance
function calculateUCB1(count: number, totalReward: number, parentVisits: number, explorationConstant: number = 1.414): number {
  if (count === 0) return Infinity;
  const exploitation = totalReward / count;
  const exploration = explorationConstant * Math.sqrt(Math.log(parentVisits) / count);
  return exploitation + exploration;
}

interface SearchNode {
  departureDate: string;
  returnDate: string;
  nights: number;
  count: number;
  totalReward: number;
  avgPrice: number;
  bestPrice: number;
  explored: boolean;
}

export function useClientSweep() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    ticket,
    config,
    setMetrics,
    addLog,
    addFlightResult,
    clearLogs,
    clearFlightResults,
    setSweepExecutionId,
    setSearchJobId,
  } = useTicketStore();

  const { addLog: addTelemetryLog } = useTelemetryStore();

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const runSweep = useCallback(async () => {
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    // SNAPSHOT: Read all required state ONCE before the sweep loop
    // This prevents race conditions if user modifies inputs during sweep
    const snapshot = useTicketStore.getState();
    const {
      ticket: snapTicket,
      config: snapConfig,
    } = snapshot;

    const baseCost = Number(snapTicket.baseCost) || 792.87;
    const maxAcceptablePrice = baseCost + Number(snapConfig.priceTolerance);
    let totalApiCalls = 0;
    let totalScanned = 0;
    let candidatesFound = 0;
    let outOfRange = 0;

    clearLogs();
    clearFlightResults();
    setMetrics({ totalScanned: 0, candidatesFound: 0, outOfRange: 0, status: 'running', progress: `0 / ${snapConfig.maxApiCalls}`, apiCallsMade: 0, maxApiCalls: snapConfig.maxApiCalls });

    addLog({ level: 'info', message: '[SYSTEM] AEROSWEEP v7.1 UCB1 ORCHESTRATOR ONLINE' });
    addLog({ level: 'info', message: `[SYSTEM] Budget: ${snapConfig.maxApiCalls} API calls | CHUNK_SIZE: ${CHUNK_SIZE}` });

    // Phase 0: Initialize Search Job in Airline Intelligence Schema
    let searchJobId: string | null = null;
    let sweepExecutionId: string | null = null;

    try {
      addLog({ level: 'info', message: '[JOB INIT] Creating search job in Airline Intelligence Schema...' });

      const searchWindowStart = snapConfig.searchWindowStart ? new Date(snapConfig.searchWindowStart).toISOString().split('T')[0] : '';
      const searchWindowEnd = snapConfig.searchWindowEnd ? new Date(snapConfig.searchWindowEnd).toISOString().split('T')[0] : '';

      const jobResult = await createSearchJob({
        p_ticket_id: snapTicket.dbTicketId || '',
        p_pnr: snapTicket.pnr,
        p_carrier_iata: snapTicket.carrier || 'A3',
        p_booking_class: snapTicket.bookingClass || 'Y',
        p_fare_family_id: snapTicket.fareFamilyId || null,
        p_parity_tier: snapTicket.parityTier || null,
        p_anchor_base_cost: baseCost,
        p_search_window_start: searchWindowStart,
        p_search_window_end: searchWindowEnd,
        p_min_nights: snapConfig.minNights,
        p_max_nights: snapConfig.maxNights,
        p_price_tolerance: Number(snapConfig.priceTolerance),
        p_max_api_calls: snapConfig.maxApiCalls,
      });

      if (jobResult) {
        searchJobId = jobResult.id;
        sweepExecutionId = jobResult.sweep_execution_id;
        setSearchJobId(searchJobId);
        setSweepExecutionId(sweepExecutionId);
        addLog({ level: 'success', message: `[JOB INIT] ✓ Search Job created: ${searchJobId}` });
        addLog({ level: 'info', message: `[JOB INIT] Sweep Execution ID: ${sweepExecutionId}` });
        addLog({ level: 'info', message: `[JOB INIT] Anchor Tier: ${snapTicket.parityTier || 'default'} | Fare Family: ${snapTicket.fareFamilyName || 'unknown'}` });
      } else {
        addLog({ level: 'warning', message: '[JOB INIT] Failed to create search job in DB - continuing in local mode' });
        const localExecId = `local-${Date.now()}`;
        setSweepExecutionId(localExecId);
        addLog({ level: 'info', message: `[JOB INIT] Using local execution ID: ${localExecId}` });
      }
    } catch (jobError) {
      console.error('[JOB INIT] Error creating search job:', jobError);
      addLog({ level: 'warning', message: '[JOB INIT] Exception creating search job - continuing in local mode' });
      const localExecId = `local-${Date.now()}`;
      setSweepExecutionId(localExecId);
    }

    // Phase 0b: Load Fare Family Cache ONCE (12 parallel RPCs, not N per candidate)
    let fareFamilyCache: FareFamilyCache = new Map();
    if (snapTicket.carrier && snapTicket.origin && snapTicket.destination) {
      try {
        addLog({ level: 'info', message: `[CACHE] Loading fare family cache for ${snapTicket.carrier} ${snapTicket.origin}-${snapTicket.destination}...` });
        fareFamilyCache = await loadFareFamilyCache(
          snapTicket.carrier,
          snapTicket.origin,
          snapTicket.destination
        );
        addLog({ level: 'success', message: `[CACHE] ✓ Loaded ${fareFamilyCache.size} fare families` });
      } catch (cacheError) {
        console.error('[CACHE] Failed to load fare family cache:', cacheError);
        addLog({ level: 'warning', message: '[CACHE] Fare family cache unavailable - using default penalties' });
      }
    } else {
      addLog({ level: 'warning', message: '[CACHE] Skipping fare family cache - missing carrier, origin, or destination' });
    }

    // Convert Map to Record for JSON serialization (strictly typed)
    const fareFamilyCacheRecord: Record<string, FareFamilyRow> = {};
    fareFamilyCache.forEach((value, key) => {
      fareFamilyCacheRecord[key] = value;
    });

    if (!snapConfig.searchWindowStart || !snapConfig.searchWindowEnd) {
      addLog({ level: 'error', message: '[SYSTEM] Search window not configured' });
      return { totalApiCalls: 0, totalScanned: 0, candidatesFound: 0 };
    }

    const startDate = new Date(snapConfig.searchWindowStart);
    const endDate = new Date(snapConfig.searchWindowEnd);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Build search space
    const searchNodes: SearchNode[] = [];
    const searchSignatures = new Set<string>();

    for (let d = 0; d <= totalDays && searchNodes.length < snapConfig.maxApiCalls; d++) {
      const depDate = addDays(startDate, d);
      for (let nights = snapConfig.minNights; nights <= snapConfig.maxNights && searchNodes.length < snapConfig.maxApiCalls; nights++) {
        const retDate = addDays(depDate, nights);
        if (retDate <= endDate) {
          const depStr = depDate.toISOString().split('T')[0];
          const retStr = retDate.toISOString().split('T')[0];
          const sig = `${depStr}_${retStr}`;

          if (!searchSignatures.has(sig)) {
            searchSignatures.add(sig);
            searchNodes.push({
              departureDate: depStr,
              returnDate: retStr,
              nights,
              count: 0,
              totalReward: 0,
              avgPrice: Infinity,
              bestPrice: Infinity,
              explored: false,
            });
          }
        }
      }
    }

    addLog({ level: 'info', message: `[SYSTEM] Generated ${searchNodes.length} unique search nodes` });

    // SNAPSHOT: Capture results in local closure to avoid race condition with UI state changes
    const finalizedResults: FlightResult[] = [];

    // Phase 1: PROBE - Strategic sampling across the timeline
    const probeCount = Math.min(24, Math.ceil(searchNodes.length * 0.15));
    const probeNodes = selectProbeNodes(searchNodes, probeCount);

    addLog({ level: 'info', message: `[PROBE PHASE] Sampling ${probeNodes.length} strategic nodes across timeline...` });

    const probeChunks = chunkArray(probeNodes, CHUNK_SIZE);
    for (let i = 0; i < probeChunks.length && !signal.aborted; i++) {
      const chunk = probeChunks[i];
      const result = await processChunk(chunk, baseCost, maxAcceptablePrice, snapTicket, snapConfig, fareFamilyCacheRecord, snapTicket.fareFamilyId, snapTicket.parityTier, snapTicket.passengerAdults, snapTicket.passengerChildren, searchJobId);

      if (signal.aborted) break;

      totalApiCalls += result.apiCalls;
      totalScanned += result.scanned;
      outOfRange += result.rejected;
      candidatesFound += result.candidates.length;

      // Update node statistics
      for (const candidate of result.candidates) {
        const node = searchNodes.find(n => n.departureDate === candidate.departureDate && n.returnDate === candidate.returnDate);
        if (node) {
          node.count++;
          node.totalReward += (baseCost - candidate.price);
          node.bestPrice = Math.min(node.bestPrice, candidate.price);
          node.avgPrice = node.totalReward / node.count;
          node.explored = true;
        }
        addLog({
          level: 'success',
          message: `[PROBE MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`,
        } as any);
        addFlightResult(candidate);
        finalizedResults.push(candidate);
      }

      updateMetrics();
      addLog({ level: 'info', message: `[PROBE ${i + 1}/${probeChunks.length}] Chunk complete | Found ${result.candidates.length} candidates` });
      await new Promise(r => setTimeout(r, 50));
    }

    if (signal.aborted) {
      addLog({ level: 'warning', message: '[SYSTEM] Sweep aborted after PROBE phase' });
      return finalize();
    }

    // Phase 2: EXPLOIT - Focus on cheapest nodes using UCB1 + surrounding dates
    const remainingBudget = snapConfig.maxApiCalls - totalApiCalls;
    const exploitationBudget = Math.floor(remainingBudget * 0.7);

    addLog({ level: 'info', message: `[EXPLOIT PHASE] Budget: ${exploitationBudget} calls | Focusing on promising nodes via UCB1...` });

    // Find TOP 3 best nodes from probe phase (not just 1)
    const probedNodes = searchNodes.filter(n => n.explored);
    const top3ProbeNodes = probedNodes.length > 0
      ? [...probedNodes]
          .sort((a, b) => a.bestPrice - b.bestPrice)
          .slice(0, 3)
      : [];

    // Add surrounding nodes (±10 days from ALL 3 top probe nodes)
    if (top3ProbeNodes.length > 0) {
      const topDates = top3ProbeNodes.map(n => `${n.departureDate}_${n.returnDate}`);
      addLog({ level: 'info', message: `[EXPLOIT] Top 3 probe dates: ${topDates.join(', ')}` });
      
      const surroundRange = 10;
      let prioritizedCount = 0;
      
      for (const topNode of top3ProbeNodes) {
        const nodeIndex = searchNodes.findIndex(n => 
          n.departureDate === topNode.departureDate && n.returnDate === topNode.returnDate
        );
        
        if (nodeIndex >= 0) {
          const surroundStart = Math.max(0, nodeIndex - surroundRange);
          const surroundEnd = Math.min(searchNodes.length - 1, nodeIndex + surroundRange);
          
          for (let i = surroundStart; i <= surroundEnd; i++) {
            if (!searchNodes[i].explored && searchNodes[i].count === 0) {
              searchNodes[i].count = 0.5; // Give partial credit to prioritize
              prioritizedCount++;
            }
          }
        }
      }
      
      addLog({ level: 'info', message: `[EXPLOIT] ${prioritizedCount} surrounding nodes prioritized (±${surroundRange} days from Top 3)` });
    }

    let exploitCalls = 0;
    const parentVisits = totalApiCalls + 1;

    while (exploitCalls < exploitationBudget && !signal.aborted) {
      // Rank unexplored nodes by UCB1 score
      const rankedNodes = searchNodes
        .filter(n => !n.explored)
        .map(node => ({
          node,
          score: calculateUCB1(node.count, baseCost - node.avgPrice, parentVisits),
        }))
        .sort((a, b) => b.score - a.score);

      if (rankedNodes.length === 0) break;

      // Select top nodes for next chunk
      const batchSize = Math.min(CHUNK_SIZE, rankedNodes.length, exploitationBudget - exploitCalls);
      const batch = rankedNodes.slice(0, batchSize).map(r => r.node);

      const result = await processChunk(batch, baseCost, maxAcceptablePrice, snapTicket, snapConfig, fareFamilyCacheRecord, snapTicket.fareFamilyId, snapTicket.parityTier, snapTicket.passengerAdults, snapTicket.passengerChildren, searchJobId);

      if (signal.aborted) break;

      totalApiCalls += result.apiCalls;
      exploitCalls += result.apiCalls;
      totalScanned += result.scanned;
      outOfRange += result.rejected;
      candidatesFound += result.candidates.length;

      for (const candidate of result.candidates) {
        const node = searchNodes.find(n => n.departureDate === candidate.departureDate && n.returnDate === candidate.returnDate);
        if (node) {
          node.count++;
          node.totalReward += (baseCost - candidate.price);
          node.bestPrice = Math.min(node.bestPrice, candidate.price);
          node.avgPrice = node.totalReward / node.count;
          node.explored = true;
        }
        addLog({
          level: 'success',
          message: `[EXPLOIT MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`,
        } as any);
        addFlightResult(candidate);
        finalizedResults.push(candidate);
      }

      updateMetrics();

      if (result.candidates.length > 0) {
        addLog({ level: 'success', message: `[EXPLOIT] Batch found ${result.candidates.length} candidates | Best: $${Math.min(...result.candidates.map(c => c.price)).toFixed(2)}` });
      }

      await new Promise(r => setTimeout(r, 50));
    }

    if (signal.aborted) {
      addLog({ level: 'warning', message: '[SYSTEM] Sweep aborted after EXPLOIT phase' });
      return finalize();
    }

    // Phase 3: DEEP SCATTER - Randomly sample unexplored weeks across entire timeline
    const scatterBudget = config.maxApiCalls - totalApiCalls;
    
    if (scatterBudget > 0) {
      addLog({ level: 'info', message: `[SCATTER PHASE] Budget: ${scatterBudget} calls | Exploring unexplored weeks...` });
      
      const unexploredNodes = searchNodes.filter(n => !n.explored);
      if (unexploredNodes.length > 0) {
        // Group by week to ensure even coverage across timeline
        const weekSize = Math.max(7, Math.floor(searchNodes.length / 50));
        const weekGroups: Map<number, SearchNode[]> = new Map();
        
        unexploredNodes.forEach(node => {
          const nodeIndex = searchNodes.indexOf(node);
          const weekIndex = Math.floor(nodeIndex / weekSize);
          if (!weekGroups.has(weekIndex)) weekGroups.set(weekIndex, []);
          weekGroups.get(weekIndex)!.push(node);
        });
        
        // Pick one random node from each week group until budget exhausted
        const weekIndices = Array.from(weekGroups.keys()).sort(() => Math.random() - 0.5);
        const scatterBatch: SearchNode[] = [];
        
        for (const wIdx of weekIndices) {
          const weekNodes = weekGroups.get(wIdx)!;
          const randomNode = weekNodes[Math.floor(Math.random() * weekNodes.length)];
          scatterBatch.push(randomNode);
          if (scatterBatch.length >= scatterBudget) break;
        }
        
        if (scatterBatch.length > 0) {
          addLog({ level: 'info', message: `[SCATTER] Sampling ${scatterBatch.length} nodes across ${weekGroups.size} week groups` });
          
          const scatterChunks = chunkArray(scatterBatch, CHUNK_SIZE);
          for (let i = 0; i < scatterChunks.length && !signal.aborted; i++) {
            const chunk = scatterChunks[i];
            const result = await processChunk(chunk, baseCost, maxAcceptablePrice, snapTicket, snapConfig, fareFamilyCacheRecord, snapTicket.fareFamilyId, snapTicket.parityTier, snapTicket.passengerAdults, snapTicket.passengerChildren, searchJobId);
            
            if (signal.aborted) break;
            
            totalApiCalls += result.apiCalls;
            totalScanned += result.scanned;
            outOfRange += result.rejected;
            candidatesFound += result.candidates.length;
            
            for (const candidate of result.candidates) {
              const node = searchNodes.find(n => n.departureDate === candidate.departureDate && n.returnDate === candidate.returnDate);
              if (node) {
                node.count++;
                node.totalReward += (baseCost - candidate.price);
                node.bestPrice = Math.min(node.bestPrice, candidate.price);
                node.avgPrice = node.totalReward / node.count;
                node.explored = true;
              }
              addLog({
                level: 'success',
                message: `[SCATTER MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`,
              } as any);
              addFlightResult(candidate);
              finalizedResults.push(candidate);
            }
            
            updateMetrics();
            addLog({ level: 'info', message: `[SCATTER ${i + 1}/${scatterChunks.length}] Chunk complete | Found ${result.candidates.length} candidates` });
            await new Promise(r => setTimeout(r, 50));
          }
        } else {
          addLog({ level: 'info', message: '[SCATTER] No unexplored nodes remaining' });
        }
      } else {
        addLog({ level: 'info', message: '[SCATTER] All nodes already explored' });
      }
    }

    if (signal.aborted) {
      addLog({ level: 'warning', message: '[SYSTEM] Sweep aborted after SCATTER phase' });
      return finalize();
    }

    // Phase 4: FINALIZE - Deep search on top matches for exact comparison
    const verifiedCandidates = searchNodes.filter(n => n.explored && n.bestPrice < maxAcceptablePrice);
    const topNodes = verifiedCandidates
      .sort((a, b) => a.bestPrice - b.bestPrice)
      .slice(0, 6);

    if (topNodes.length > 0) {
      addLog({ level: 'info', message: `[FINALIZE PHASE] Deep search on ${topNodes.length} top candidates for exact mapping...` });

      const finalizeChunks = chunkArray(topNodes, CHUNK_SIZE);
      for (let i = 0; i < finalizeChunks.length && !signal.aborted; i++) {
        const chunk = finalizeChunks[i];
        const result = await processChunk(chunk, baseCost, maxAcceptablePrice, snapTicket, snapConfig, fareFamilyCacheRecord, snapTicket.fareFamilyId, snapTicket.parityTier, snapTicket.passengerAdults, snapTicket.passengerChildren, searchJobId);

        if (signal.aborted) break;

        totalApiCalls += result.apiCalls;
        totalScanned += result.scanned;
        outOfRange += result.rejected;
        candidatesFound += result.candidates.length;

        for (const candidate of result.candidates) {
          const verifiedCandidate = { ...candidate, status: 'verified' };
          addLog({
            level: 'success',
            message: `[FINALIZE MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)} ✓`,
          } as any);
          addFlightResult(verifiedCandidate);
          finalizedResults.push(verifiedCandidate);
        }

        updateMetrics();
        addLog({ level: 'info', message: `[FINALIZE ${i + 1}/${finalizeChunks.length}] Deep search complete` });
      }
    }

    return finalize();

    async function processChunk(
      nodes: SearchNode[],
      baseCost: number,
      maxPrice: number,
      ticket: any,
      config: any,
      fareFamilyCache: Record<string, any>,
      anchorFamilyId: string | null | undefined,
      anchorTier: number | null | undefined,
      passengerAdults: number | undefined,
      passengerChildren: number | undefined,
      jobId: string | null
    ): Promise<{ apiCalls: number; scanned: number; rejected: number; candidates: any[] }> {
      if (signal.aborted) {
        return { apiCalls: 0, scanned: 0, rejected: 0, candidates: [] };
      }

      const searches = nodes.map(n => ({ departureDate: n.departureDate, returnDate: n.returnDate }));

      try {
        const res = await fetch('/api/duffel-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searches,
            origin: ticket.origin || 'CAI',
            destination: ticket.destination || 'ATH',
            cabinClass: 'economy',
            passengerCount: ticket.passengers.length,
            baseCost,
            priceTolerance: config.priceTolerance,
            originalCarrier: ticket.carrier || 'A3',
            directFlightOnly: config.directFlightOnly,
            fareFamilyCache,
            anchorFamilyId,
            anchorTier,
            passengerAdults,
            passengerChildren,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const isCacheHit = data._isCacheHit === true;
        const candidates: any[] = [];
        let scanned = 0;
        let rejected = 0;

        for (const result of data.results) {
          scanned += result.rawOffersCount;
          rejected += result.rejectedCount;
          candidates.push(...result.candidates);
        }

        if (isCacheHit) {
          addLog({ level: 'info', message: `[CACHE HIT] ${searches.length} results served from Redis cache` });
        }

        return {
          apiCalls: searches.length,
          scanned,
          rejected,
          candidates,
        };
      } catch (err) {
        addLog({ level: 'error', message: `[CHUNK ERROR] ${err instanceof Error ? err.message : 'Unknown'}` });
        return { apiCalls: searches.length, scanned: 0, rejected: 0, candidates: [] };
      }
    }

    function updateMetrics() {
      setMetrics({
        totalScanned,
        candidatesFound,
        outOfRange,
        status: 'running',
        progress: `${totalApiCalls}/${snapConfig.maxApiCalls}`,
        apiCallsMade: totalApiCalls,
        maxApiCalls: snapConfig.maxApiCalls,
      });
    }

    async function finalize() {
      const finalStatus = signal.aborted ? 'aborted' : 'completed';
      setMetrics({
        totalScanned,
        candidatesFound,
        outOfRange,
        status: finalStatus,
        progress: `${totalApiCalls}/${snapConfig.maxApiCalls}`,
        apiCallsMade: totalApiCalls,
        maxApiCalls: snapConfig.maxApiCalls,
      });

      addLog({
        level: 'success',
        message: `[COMPLETE] API: ${totalApiCalls} | Scanned: ${totalScanned} | Matches: ${candidatesFound} | Phases: PROBE→EXPLOIT→FINALIZE`,
      });

      addTelemetryLog({
        source: 'SYSTEM',
        type: 'RESPONSE',
        message: `Sweep ${finalStatus} via UCB1`,
        payload: { totalApiCalls, totalScanned, candidatesFound, phases: ['PROBE', 'EXPLOIT', 'FINALIZE'] },
      });

      // Update search job status in DB
      if (searchJobId) {
        updateSearchJob(searchJobId, {
          status: finalStatus,
          total_scanned: totalScanned,
          candidates_found: candidatesFound,
          completed_at: new Date().toISOString(),
        }).then(() => {
          addLog({ level: 'info', message: `[JOB UPDATE] Search job ${searchJobId} marked as ${finalStatus}` });
        }).catch(err => {
          console.error('[JOB UPDATE] Failed to update search job:', err);
        });
      }

      // Persist flight results to DB (batched) - using local snapshot to avoid race condition
      const allResults = finalizedResults;
      if (searchJobId && allResults.length > 0) {
        try {
          const searchResultRows = allResults.map(c => ({
            job_id: searchJobId,
            outbound_flight: c.outboundSegments?.[0]?.flightNumber || '',
            inbound_flight: c.inboundSegments?.[0]?.flightNumber || '',
            outbound_dep: c.departureDate || '',
            inbound_dep: c.returnDate || '',
            nights: c.nights,
            carrier_iata: c.carrier,
            booking_class_out: c.bookingClass || 'Y',
            fare_family_name: c.resolvedFamilyName || 'Unknown',
            base_fare_eur: c.price,
            taxes_eur: 0,
            total_raw_eur: c.price,
            parity_total_penalty: c.metadata?.tierPenalty || 0,
            total_normalized_eur: c.price + (c.metadata?.tierPenalty || 0),
            net_saving_eur: baseCost - (c.price + (c.metadata?.tierPenalty || 0)),
            is_saving: (baseCost - (c.price + (c.metadata?.tierPenalty || 0))) > 0,
            status: c.status,
            penalty_badge: c.penaltyBadge || null,
            raw_offer: null,
          }));

          const insertSuccess = await bulkInsertSearchResults(searchResultRows);
          if (insertSuccess) {
            addLog({ level: 'success', message: `[DB] Persisted ${searchResultRows.length} results to search_results` });
          } else {
            addLog({ level: 'error', message: `[DB] Failed to persist search_results - see server logs` });
          }

          // UPSERT price_calendar with cheapest normalized cost per (date, nights)
          const calendarMap = new Map<string, typeof allResults[0]>();
          for (const c of allResults) {
            const key = `${c.departureDate}-${c.nights}`;
            const existing = calendarMap.get(key);
            const normalizedCost = c.price + (c.metadata?.tierPenalty || 0);
            const existingCost = existing
              ? existing.price + (existing.metadata?.tierPenalty || 0)
              : Infinity;
            if (normalizedCost < existingCost) {
              calendarMap.set(key, c);
            }
          }

          const calendarRows = Array.from(calendarMap.values()).map(c => ({
            job_id: searchJobId,
            outbound_date: c.departureDate,
            nights: c.nights,
            cheapest_raw: c.price,
            cheapest_normalized: c.price + (c.metadata?.tierPenalty || 0),
            fare_family: c.resolvedFamilyName || 'Unknown',
            booking_class: c.bookingClass || 'Y',
            data_source: 'DUFFEL' as const,
            confidence: null,
          }));

          const calendarSuccess = await upsertPriceCalendar(calendarRows);
          if (calendarSuccess) {
            addLog({ level: 'success', message: `[DB] UPSERTed ${calendarRows.length} entries to price_calendar` });
          } else {
            addLog({ level: 'error', message: `[DB] Failed to UPSERT price_calendar - see server logs` });
          }
        } catch (dbError) {
          console.error('[DB] Failed to persist results:', dbError);
          addLog({ level: 'warning', message: `[DB] Failed to persist results to DB - see logs` });
        }
      }

      return { totalApiCalls, totalScanned, candidatesFound };
    }

    function selectProbeNodes(nodes: SearchNode[], count: number): SearchNode[] {
      if (nodes.length <= count) return nodes;

      // True UCB1 Sparse Probe: evenly spaced indices across the timeline
      // Formula: filter nodes where index % Math.floor(totalNodes / probeCount) === 0
      const step = Math.max(1, Math.floor(nodes.length / count));
      const selected: SearchNode[] = [];
      
      for (let i = 0; i < nodes.length; i++) {
        if (i % step === 0 && selected.length < count) {
          selected.push(nodes[i]);
        }
      }

      return selected;
    }

  }, [ticket, config, setMetrics, addLog, addFlightResult, clearLogs, clearFlightResults, addTelemetryLog, setSweepExecutionId, setSearchJobId]);

  return { runSweep, abort };
}
