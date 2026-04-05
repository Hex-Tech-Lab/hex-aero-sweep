import { useCallback, useRef } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';

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

    const baseCost = ticket.baseCost || 792.87;
    const maxAcceptablePrice = baseCost + config.priceTolerance;
    let totalApiCalls = 0;
    let totalScanned = 0;
    let candidatesFound = 0;
    let outOfRange = 0;

    clearLogs();
    clearFlightResults();
    setMetrics({ totalScanned: 0, candidatesFound: 0, outOfRange: 0, status: 'running' });

    addLog({ level: 'info', message: '[SYSTEM] AEROSWEEP v7.1 UCB1 ORCHESTRATOR ONLINE' });
    addLog({ level: 'info', message: `[SYSTEM] Budget: ${config.maxApiCalls} API calls | CHUNK_SIZE: ${CHUNK_SIZE}` });

    if (!config.searchWindowStart || !config.searchWindowEnd) {
      addLog({ level: 'error', message: '[SYSTEM] Search window not configured' });
      return { totalApiCalls: 0, totalScanned: 0, candidatesFound: 0 };
    }

    const startDate = new Date(config.searchWindowStart);
    const endDate = new Date(config.searchWindowEnd);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Build search space
    const searchNodes: SearchNode[] = [];
    const searchSignatures = new Set<string>();

    for (let d = 0; d <= totalDays && searchNodes.length < config.maxApiCalls; d++) {
      const depDate = addDays(startDate, d);
      for (let nights = config.minNights; nights <= config.maxNights && searchNodes.length < config.maxApiCalls; nights++) {
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

    // Phase 1: PROBE - Strategic sampling across the timeline
    const probeCount = Math.min(24, Math.ceil(searchNodes.length * 0.15));
    const probeNodes = selectProbeNodes(searchNodes, probeCount);

    addLog({ level: 'info', message: `[PROBE PHASE] Sampling ${probeNodes.length} strategic nodes across timeline...` });

    const probeChunks = chunkArray(probeNodes, CHUNK_SIZE);
    for (let i = 0; i < probeChunks.length && !signal.aborted; i++) {
      const chunk = probeChunks[i];
      const result = await processChunk(chunk, baseCost, maxAcceptablePrice, ticket, config);

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
    const remainingBudget = config.maxApiCalls - totalApiCalls;
    const exploitationBudget = Math.floor(remainingBudget * 0.7);

    addLog({ level: 'info', message: `[EXPLOIT PHASE] Budget: ${exploitationBudget} calls | Focusing on promising nodes via UCB1...` });

    // Find best node from probe phase
    const probedNodes = searchNodes.filter(n => n.explored);
    const bestProbeNode = probedNodes.length > 0 
      ? probedNodes.reduce((best, node) => node.bestPrice < best.bestPrice ? node : best, probedNodes[0])
      : null;

    // Add surrounding nodes (±10 days from best probe node)
    if (bestProbeNode) {
      const bestIndex = searchNodes.findIndex(n => 
        n.departureDate === bestProbeNode.departureDate && n.returnDate === bestProbeNode.returnDate
      );
      const surroundRange = 10;
      const surroundStart = Math.max(0, bestIndex - surroundRange);
      const surroundEnd = Math.min(searchNodes.length - 1, bestIndex + surroundRange);
      
      for (let i = surroundStart; i <= surroundEnd; i++) {
        if (!searchNodes[i].explored && searchNodes[i].count === 0) {
          searchNodes[i].count = 0.5; // Give partial credit to prioritize
        }
      }
      addLog({ level: 'info', message: `[EXPLOIT] Best probe: ${bestProbeNode.departureDate} | Surrounding ±${surroundRange} days prioritized` });
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

      const result = await processChunk(batch, baseCost, maxAcceptablePrice, ticket, config);

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

    // Phase 3: FINALIZE - Deep search on top matches for exact comparison
    const verifiedCandidates = searchNodes.filter(n => n.explored && n.bestPrice < maxAcceptablePrice);
    const topNodes = verifiedCandidates
      .sort((a, b) => a.bestPrice - b.bestPrice)
      .slice(0, 6);

    if (topNodes.length > 0) {
      addLog({ level: 'info', message: `[FINALIZE PHASE] Deep search on ${topNodes.length} top candidates for exact mapping...` });

      const finalizeChunks = chunkArray(topNodes, CHUNK_SIZE);
      for (let i = 0; i < finalizeChunks.length && !signal.aborted; i++) {
        const chunk = finalizeChunks[i];
        const result = await processChunk(chunk, baseCost, maxAcceptablePrice, ticket, config);

        if (signal.aborted) break;

        totalApiCalls += result.apiCalls;
        totalScanned += result.scanned;
        outOfRange += result.rejected;
        candidatesFound += result.candidates.length;

        for (const candidate of result.candidates) {
          addLog({
            level: 'success',
            message: `[FINALIZE MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)} ✓`,
          } as any);
          addFlightResult({ ...candidate, status: 'verified' });
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
      config: any
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
        const candidates: any[] = [];
        let scanned = 0;
        let rejected = 0;

        for (const result of data.results) {
          scanned += result.rawOffersCount;
          rejected += result.rejectedCount;
          candidates.push(...result.candidates);
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
        progress: `${totalApiCalls}/${config.maxApiCalls}`,
        apiCallsMade: totalApiCalls,
        maxApiCalls: config.maxApiCalls,
      });
    }

    function finalize() {
      const finalStatus = signal.aborted ? 'aborted' : 'completed';
      setMetrics({
        totalScanned,
        candidatesFound,
        outOfRange,
        status: finalStatus,
        progress: `${totalApiCalls}/${config.maxApiCalls}`,
        apiCallsMade: totalApiCalls,
        maxApiCalls: config.maxApiCalls,
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

  }, [ticket, config, setMetrics, addLog, addFlightResult, clearLogs, clearFlightResults, addTelemetryLog]);

  return { runSweep, abort };
}
