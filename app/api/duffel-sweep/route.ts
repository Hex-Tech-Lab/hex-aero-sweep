import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
import { updateSearchLog } from '@/lib/supabase-operations';
import { searchDuffelOffers, isDuffelConfigured, FlightCandidate, OriginalTicketData, SearchResult, getHistoricPriors } from '@/lib/duffel-service';
import { UCB1, WeeklyYieldData, WeeklyRewardData, microBatch } from '@/lib/ucb1';

type SSEMessage = {
  type: 'metrics' | 'log' | 'candidate' | 'complete' | 'error' | 'duffel_payload';
  data: any;
};

const PHASE_LABELS = {
  SEEDING: '[PHASE 0: SEEDING PRIORS]',
  PROBE: '[PHASE 1: UCB PROBING]',
  BRACKET: '[PHASE 2: BRACKETING]',
  EXPLOIT: '[PHASE 3: DENSE EXPLOIT]',
  POLISH: '[PHASE 4: POLISH]',
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getWeekStarts(startDate: Date, endDate: Date): Date[] {
  const weeks: Date[] = [];
  const current = new Date(startDate);
  current.setDate(current.getDate() - current.getDay() + 1);

  while (current <= endDate) {
    weeks.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

function generateAdjacentDates(centerDate: Date, spreadDays: number = 2): Date[] {
  if (spreadDays <= 0) return [centerDate];
  const dates: Date[] = [];
  for (let offset = -spreadDays; offset <= spreadDays; offset++) {
    if (offset !== 0) {
      dates.push(addDays(centerDate, offset));
    }
  }
  dates.unshift(centerDate);
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processor: (item: T) => Promise<R>,
  onChunkComplete?: (results: R[], chunkIndex: number) => void,
  flushCallback?: () => void
): Promise<R[]> {
  const chunks = chunkArray(items, chunkSize);
  const results: R[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkResults = await Promise.all(chunks[i].map(processor));
    results.push(...chunkResults);
    
    if (onChunkComplete) {
      onChunkComplete(chunkResults, i);
    }
    
    if (flushCallback) {
      flushCallback();
    }
    
    await new Promise(r => setTimeout(r, 50));
  }

  return results;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  console.log('Incoming Params:', Object.fromEntries(searchParams));

  const sessionId = searchParams.get('sessionId');
  const searchWindowStart = searchParams.get('searchWindowStart');
  const searchWindowEnd = searchParams.get('searchWindowEnd');
  const minNights = parseInt(searchParams.get('minNights') || '3');
  const maxNights = parseInt(searchParams.get('maxNights') || '14');
  const priceTolerance = parseFloat(searchParams.get('priceTolerance') || '50');
  const maxApiCalls = parseInt(searchParams.get('maxApiCalls') || '100');
  const baseCost = parseFloat(searchParams.get('baseCost') || '500');
  const passengerCount = parseInt(searchParams.get('passengers') || '1');
  const fareClass = (searchParams.get('fareClass') || 'ECONOMY').toLowerCase();

  const directFlightOnly = searchParams.get('directFlightOnly') === 'true';
  const outboundTimePreference = searchParams.get('outboundTimePreference') || 'any';
  const inboundTimePreference = searchParams.get('inboundTimePreference') || 'any';

  const passengerBreakdownRaw = searchParams.get('passengerBreakdown');
  let passengerBreakdown = undefined;
  if (passengerBreakdownRaw) {
    try {
      passengerBreakdown = JSON.parse(passengerBreakdownRaw);
    } catch (e) {
      console.warn('[API] Failed to parse passengerBreakdown:', e);
    }
  }

  const origin = searchParams.get('origin') || 'CAI';
  const destination = searchParams.get('destination') || 'ATH';
  const originalCarrier = searchParams.get('carrier') || 'A3';

  if (!sessionId || !searchWindowStart || !searchWindowEnd) {
    return new Response(
      JSON.stringify({ error: 'Missing required parameters' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    await updateSearchLog(sessionId, { status: 'in_progress' });
  } catch (error) {
    console.error('Failed to update search log:', error);
  }

  const encoder = new TextEncoder();
  let totalApiCalls = 0;
  let totalScanned = 0;
  let candidatesFound = 0;
  let outOfRange = 0;

  const originalTicketData: OriginalTicketData = {
    carrier: originalCarrier,
    origin,
    destination,
    routeLegs: [{ from: origin, to: destination }],
    departureDate: searchWindowStart,
  };

  const cabinClassMap: Record<string, 'economy' | 'business' | 'first' | 'premium_economy'> = {
    economy: 'economy',
    business: 'business',
    first: 'first',
    'premium economy': 'premium_economy',
  };

  const cabinClass = cabinClassMap[fareClass] || 'economy';

  const searchedSignatures = new Set<string>();
  const seenCandidates = new Map<string, boolean>();
  
  function getSearchSignature(departureDate: string, returnDate: string): string {
    return `${departureDate}_${returnDate}`;
  }
  
  function getCandidateKey(candidate: any): string {
    return `${candidate.departureDate}_${candidate.returnDate}_${candidate.price}_${candidate.carrier}`;
  }

  const stream = new ReadableStream({
    async start(controller) {
      function sendMessage(message: SSEMessage) {
        const data = `data: ${JSON.stringify(message)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      function sendMetrics(phase: string) {
        sendMessage({
          type: 'metrics',
          data: {
            totalScanned,
            candidatesFound,
            outOfRange,
            progress: `${totalApiCalls}/${maxApiCalls}`,
            phase,
            apiCallsMade: totalApiCalls,
            maxApiCalls: maxApiCalls,
            skippedDuplicates: searchedSignatures.size - totalApiCalls,
          },
        });
      }

      function sendLog(level: string, message: string) {
        sendMessage({
          type: 'log',
          data: { level, message },
        });
      }

      sendLog('success', '[SYSTEM] AEROSWEEP v7.0 UCB1 HEURISTIC ENGINE ONLINE');

      await new Promise((resolve) => setTimeout(resolve, 500));

      const duffelConfigured = isDuffelConfigured();

      if (!duffelConfigured) {
        sendLog('warning', '[DUFFEL] API not configured - execution aborted');
        sendMessage({
          type: 'error',
          data: {
            message: 'Duffel API key not configured. Please add DUFFEL_API_KEY to environment variables.',
          },
        });
        try {
          await updateSearchLog(sessionId, { status: 'aborted' });
        } catch (dbError) {
          console.error('Failed to update search log on abort:', dbError);
        }
        controller.close();
        return;
      }

      sendLog('success', '[DUFFEL] Live API authenticated');

      const startDate = new Date(searchWindowStart);
      const endDate = new Date(searchWindowEnd);
      const DAY_MS = 1000 * 60 * 60 * 24;
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS);

      const weekStarts = getWeekStarts(startDate, endDate);
      const weekCount = weekStarts.length;

      sendLog('info', `[CONFIG] Carrier: ${originalCarrier} | Route: ${origin}-${destination} | Window: ${totalDays} days | ${weekCount} weeks`);

      const phase0Budget = Math.floor(maxApiCalls * 0.0);
      const phase1Budget = Math.floor(maxApiCalls * 0.30);
      const phase2Budget = Math.floor(maxApiCalls * 0.00);
      const phase3Budget = Math.floor(maxApiCalls * 0.60);
      const phase4Budget = Math.max(0, maxApiCalls - phase0Budget - phase1Budget - phase2Budget - phase3Budget);

      try {
        sendLog('info', `${PHASE_LABELS.SEEDING} Loading historic priors from Amadeus/Stub`);

        const priors = getHistoricPriors(origin, destination, startDate, endDate);
        const originalBrand = originalTicketData.brand || 'Standard';

        const ucb1 = new UCB1(weekStarts, 1.5);
        ucb1.seedWithPriors(priors);

        sendLog('success', `[SYSTEM] Loaded ${priors.length} historical records. Defaulting to exact match for: ${originalBrand}`);
        sendLog('success', `${PHASE_LABELS.SEEDING} Loaded ${priors.length} prior weeks (UCB1 initialized)`);
        sendMessage({
          type: 'metrics',
          data: { phase: 'PHASE 0', armsInitialized: weekCount, priorsLoaded: priors.length, totalScanned: 0, candidatesFound: 0, outOfRange: 0, progress: `0/${maxApiCalls}` },
        });

        sendLog('info', `${PHASE_LABELS.PROBE} Sparse probe: ${phase1Budget} calls across ${weekCount} weeks`);

        const phase1Results: { weekIndex: number; bestYield: number; sampleCount: number }[] = [];
        let probesExecuted = 0;

        while (probesExecuted < phase1Budget && probesExecuted < weekCount * 2) {
          const selectedArm = ucb1.select(1.5);
          const probeDate = selectedArm.weekStartDate;

          const departureDate = probeDate.toISOString().split('T')[0];
          const nights = Math.floor((minNights + maxNights) / 2);
          const returnDate = addDays(probeDate, nights).toISOString().split('T')[0];
          const searchSig = getSearchSignature(departureDate, returnDate);

          if (searchedSignatures.has(searchSig)) {
            sendLog('info', `[SKIP] Already searched ${departureDate} - ${nights}N`);
            continue;
          }
          searchedSignatures.add(searchSig);

          sendLog('info', `[PROBE ${probesExecuted + 1}/${phase1Budget}] Week ${selectedArm.weekIndex}: ${departureDate} - ${nights}N`);

          totalApiCalls++;

          try {
            const searchResult = await searchDuffelOffers({
              origin,
              destination,
              departureDate,
              returnDate,
              passengers: 1,
              cabinClass,
              originalTicket: originalTicketData,
              baseCost,
              preferences: {
                directFlightOnly,
                outboundTimePreference: outboundTimePreference as any,
                inboundTimePreference: inboundTimePreference as any,
              },
            });

            const { candidates, rawOffersCount, rejectedCount } = searchResult;
            totalScanned += rawOffersCount;
            outOfRange += rejectedCount;

            const maxAcceptablePrice = baseCost + priceTolerance;
            let bestPrice = Infinity;
            for (const candidate of candidates) {
              const candidateKey = getCandidateKey(candidate);
              if (seenCandidates.has(candidateKey)) {
                continue;
              }
              seenCandidates.set(candidateKey, true);
              
              if (candidate.price > maxAcceptablePrice) {
                sendLog('info', `[CEILING] ${candidate.departureDate}: $${candidate.price.toFixed(2)} exceeds max $${maxAcceptablePrice.toFixed(2)}`);
                continue;
              }
              
              if (candidate.status === 'verified') {
                candidatesFound++;
                sendLog('success', `[MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)}`);
              }
              sendMessage({ type: 'candidate', data: candidate });
              if (candidate.price < bestPrice) {
                bestPrice = candidate.price;
              }
            }

            if (bestPrice < Infinity) {
              const yieldDelta = bestPrice - baseCost;
              const reward = -yieldDelta;
              const rewardData: WeeklyRewardData = {
                weekIndex: selectedArm.weekIndex,
                weekStartDate: probeDate,
                reward,
                sampleCount: 1,
              };
              ucb1.update(selectedArm.weekIndex, rewardData);
              phase1Results.push({ weekIndex: selectedArm.weekIndex, bestYield: yieldDelta, sampleCount: 1 });
            }

          } catch (searchError) {
            sendLog('warning', `[ERROR] ${departureDate}: ${searchError instanceof Error ? searchError.message : 'Unknown'}`);
            const penaltyReward: WeeklyRewardData = {
              weekIndex: selectedArm.weekIndex,
              weekStartDate: probeDate,
              reward: 500,
              sampleCount: 1,
            };
            ucb1.update(selectedArm.weekIndex, penaltyReward);
            phase1Results.push({ weekIndex: selectedArm.weekIndex, bestYield: 500, sampleCount: 1 });
          }

          sendMetrics('PHASE 1');
          probesExecuted++;

          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        sendLog('success', `${PHASE_LABELS.BRACKET} Analyzing Phase 1 results`);

        const dedupedResults = phase1Results.reduce((acc, curr) => {
          const existing = acc.find(r => r.weekIndex === curr.weekIndex);
          if (!existing || curr.bestYield < existing.bestYield) {
            if (existing) {
              const idx = acc.indexOf(existing);
              acc[idx] = curr;
            } else {
              acc.push(curr);
            }
          }
          return acc;
        }, [] as typeof phase1Results);

        const top3Weeks = [...dedupedResults]
          .sort((a, b) => a.bestYield - b.bestYield)
          .slice(0, 3);

        sendLog('info', `${PHASE_LABELS.BRACKET} Top 3 weeks identified: ${top3Weeks.map(w => `Week ${w.weekIndex} (Δ$${w.bestYield.toFixed(0)})`).join(' | ')}`);

        sendLog('info', `${PHASE_LABELS.EXPLOIT} Dense exploit: ${phase3Budget} calls for actual passenger count (pax=${passengerCount})`);

        const exploitSearches: { departureDate: string; returnDate: string }[] = [];

        for (const topWeek of top3Weeks) {
          const weekStart = weekStarts[topWeek.weekIndex];
          const adjacentDates = generateAdjacentDates(weekStart, 2);

          for (const adjDate of adjacentDates) {
            for (let nights = minNights; nights <= maxNights; nights++) {
              const returnDate = addDays(adjDate, nights);
              if (returnDate <= endDate && exploitSearches.length < phase3Budget) {
                exploitSearches.push({
                  departureDate: adjDate.toISOString().split('T')[0],
                  returnDate: returnDate.toISOString().split('T')[0],
                });
              }
            }
          }
        }

        const chunkedSearches = exploitSearches.slice(0, phase3Budget);

        const filteredSearches = chunkedSearches.filter(s => {
          const sig = getSearchSignature(s.departureDate, s.returnDate);
          if (searchedSignatures.has(sig)) {
            return false;
          }
          searchedSignatures.add(sig);
          return true;
        });

        const maxAcceptablePrice = baseCost + priceTolerance;
        
        let exploitIndex = 0;
        const chunks = chunkArray(filteredSearches, 3);
        
        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          if (totalApiCalls >= maxApiCalls) break;
          
          const chunk = chunks[chunkIdx];
          const chunkStart = exploitIndex;
          
          await Promise.all(chunk.map(async (search) => {
            const idx = exploitIndex++;
            sendLog('info', `[EXPLOIT ${idx + 1}/${filteredSearches.length}] ${search.departureDate} (${search.returnDate})`);

            try {
              totalApiCalls++;
              const result = await searchDuffelOffers({
                origin,
                destination,
                departureDate: search.departureDate,
                returnDate: search.returnDate,
                passengers: passengerCount,
                cabinClass,
                originalTicket: originalTicketData,
                baseCost,
                preferences: {
                  directFlightOnly,
                  outboundTimePreference: outboundTimePreference as any,
                  inboundTimePreference: inboundTimePreference as any,
                  passengerBreakdown,
                },
              });

              totalScanned += result.rawOffersCount;
              outOfRange += result.rejectedCount;

              for (const candidate of result.candidates) {
                const candidateKey = getCandidateKey(candidate);
                if (seenCandidates.has(candidateKey)) continue;
                seenCandidates.set(candidateKey, true);
                
                if (candidate.price > maxAcceptablePrice) {
                  sendLog('info', `[CEILING] ${candidate.departureDate}: $${candidate.price.toFixed(2)} exceeds max $${maxAcceptablePrice.toFixed(2)}`);
                  continue;
                }
                
                if (candidate.status === 'verified') {
                  candidatesFound++;
                  sendLog('success', `[MATCH!] ${candidate.carrier} ${candidate.departureDate} | ${candidate.nights}N | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`);
                }
                sendMessage({ type: 'candidate', data: candidate });
              }
            } catch (err) {
              totalApiCalls--;
              sendLog('warn', `[TIMEOUT] Skipping ${search.departureDate}: ${err instanceof Error ? err.message : 'Unknown'}`);
              return;
            }
          }));

          sendMetrics('PHASE 3');
          await new Promise(r => setTimeout(r, 100));
        }

        sendLog('info', `${PHASE_LABELS.POLISH} Polish phase: ${phase4Budget} calls for time-window permutations`);

        const polishCandidates = top3Weeks.slice(0, 2);
        const polishSearches: { departureDate: string; returnDate: string; preference: string }[] = [];

        for (const candidate of polishCandidates) {
          const weekStart = weekStarts[candidate.weekIndex];
          const dateStr = weekStart.toISOString().split('T')[0];
          const nights = Math.floor((minNights + maxNights) / 2);
          const returnDate = addDays(weekStart, nights).toISOString().split('T')[0];

          polishSearches.push(
            { departureDate: dateStr, returnDate, preference: 'morning' },
            { departureDate: dateStr, returnDate, preference: 'evening' }
          );
        }

        let polishIndex = 0;
        const filteredPolishSearches = polishSearches.filter(s => {
          const sig = getSearchSignature(s.departureDate, s.returnDate);
          if (searchedSignatures.has(sig)) {
            return false;
          }
          searchedSignatures.add(sig);
          return true;
        });

        const polishMaxAcceptablePrice = baseCost + priceTolerance;
        for (const search of filteredPolishSearches) {
          if (polishIndex >= phase4Budget || totalApiCalls >= maxApiCalls) break;

          sendLog('info', `[POLISH ${polishIndex + 1}/${Math.min(filteredPolishSearches.length, phase4Budget)}] ${search.departureDate} (${search.preference})`);

          totalApiCalls++;

          try {
            const searchResult = await searchDuffelOffers({
              origin,
              destination,
              departureDate: search.departureDate,
              returnDate: search.returnDate,
              passengers: passengerCount,
              cabinClass,
              originalTicket: originalTicketData,
              baseCost,
              preferences: {
                directFlightOnly,
                outboundTimePreference: search.preference as any,
                inboundTimePreference: inboundTimePreference as any,
                passengerBreakdown,
              },
            });

            totalScanned += searchResult.rawOffersCount;
            outOfRange += searchResult.rejectedCount;

            for (const candidate of searchResult.candidates) {
              const candidateKey = getCandidateKey(candidate);
              if (seenCandidates.has(candidateKey)) {
                continue;
              }
              seenCandidates.set(candidateKey, true);
              
              if (candidate.price > polishMaxAcceptablePrice) {
                sendLog('info', `[CEILING] ${candidate.departureDate}: $${candidate.price.toFixed(2)} exceeds max $${polishMaxAcceptablePrice.toFixed(2)}`);
                continue;
              }
              
              if (candidate.status === 'verified') {
                candidatesFound++;
                sendLog('success', `[POLISH MATCH] ${candidate.carrier} ${candidate.departureDate} | $${candidate.price.toFixed(2)}`);
              }
              sendMessage({ type: 'candidate', data: candidate });
            }

          } catch (searchError) {
            sendLog('warning', `[POLISH ERROR] ${search.departureDate}: ${searchError instanceof Error ? searchError.message : 'Unknown'}`);
          }

          polishIndex++;
          sendMetrics('PHASE 4');
          await new Promise(r => setTimeout(r, 200));
        }

        const armStats = ucb1.getArmStats();
        sendLog('success', `[UCB1 SUMMARY] Final arm statistics:`);
        for (const arm of armStats) {
          if (arm.visits > 0) {
            sendLog('info', `  Week ${arm.weekIndex}: mean=$${arm.meanReward.toFixed(0)}, visits=${arm.visits}, UCB=${arm.ucb.toFixed(0)}`);
          }
        }

        const skippedDups = searchedSignatures.size - totalApiCalls;
        sendLog('success', `[COMPLETE] API Calls: ${totalApiCalls}/${maxApiCalls} | Unique Searches: ${searchedSignatures.size} | Skipped: ${skippedDups} | Scanned: ${totalScanned} | Matches: ${candidatesFound}`);

        sendMessage({
          type: 'complete',
          data: {
            totalScanned,
            candidatesFound,
            outOfRange,
            totalApiCalls,
            maxApiCalls,
            uniqueSearches: searchedSignatures.size,
            skippedDuplicates: skippedDups,
            phaseBreakdown: {
              phase0: phase0Budget,
              phase1: probesExecuted,
              phase2: phase2Budget,
              phase3: exploitIndex,
              phase4: polishIndex,
            },
            ucb1ArmStats: armStats,
          },
        });

        try {
          await updateSearchLog(sessionId, {
            status: 'completed',
            api_calls_used: totalApiCalls,
            results_found: candidatesFound,
            completed_at: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error('Failed to update search log on completion:', dbError);
        }

      } catch (error) {
        sendMessage({
          type: 'error',
          data: {
            message: error instanceof Error ? error.message : 'Unknown error occurred',
          },
        });

        try {
          await updateSearchLog(sessionId, {
            status: 'error',
            api_calls_used: totalApiCalls,
            results_found: candidatesFound,
            completed_at: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error('Failed to update search log on error:', dbError);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
