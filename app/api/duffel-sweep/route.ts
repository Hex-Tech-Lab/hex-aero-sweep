import { NextRequest } from 'next/server';
import { updateSearchLog } from '@/lib/supabase-operations';
import { searchDuffelOffers, isDuffelConfigured, FlightCandidate, OriginalTicketData, SearchResult } from '@/lib/duffel-service';

type SSEMessage = {
  type: 'metrics' | 'log' | 'candidate' | 'complete' | 'error' | 'duffel_payload';
  data: any;
};

const DEVELOPER_VERBOSE_MODE = process.env.DEVELOPER_VERBOSE_MODE === 'true';

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function generateSparseDates(startDate: Date, endDate: Date, numDates: number): Date[] {
  const dates: Date[] = [];
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const step = totalDays / numDates;
  
  for (let i = 0; i < numDates; i++) {
    const dayOffset = Math.round(i * step);
    const date = addDays(startDate, dayOffset);
    if (date <= endDate && !dates.some(d => d.toDateString() === date.toDateString())) {
      dates.push(date);
    }
  }
  
  if (dates.length < numDates && dates[dates.length - 1] < endDate) {
    dates.push(endDate);
  }
  
  return dates.slice(0, numDates);
}

function generateDenseDates(centerDate: Date, numDates: number, windowDays: number = 3): Date[] {
  const dates: Date[] = [];
  
  for (let offset = -windowDays; offset <= windowDays; offset++) {
    if (offset === 0) continue;
    dates.push(addDays(centerDate, offset));
  }
  
  dates.unshift(centerDate);
  
  return dates.sort((a, b) => a.getTime() - b.getTime()).slice(0, numDates);
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
  };

  const cabinClassMap: Record<string, 'economy' | 'business' | 'first' | 'premium_economy'> = {
    economy: 'economy',
    business: 'business',
    first: 'first',
    'premium economy': 'premium_economy',
  };

  const cabinClass = cabinClassMap[fareClass] || 'economy';

  const stream = new ReadableStream({
    async start(controller) {
      function sendMessage(message: SSEMessage) {
        const data = `data: ${JSON.stringify(message)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      sendMessage({
        type: 'log',
        data: {
          level: 'success',
          message: '[SYSTEM] AEROSWEEP v4.0 HEURISTIC ENGINE ONLINE',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 800));

      const duffelConfigured = isDuffelConfigured();

      if (!duffelConfigured) {
        sendMessage({
          type: 'log',
          data: {
            level: 'warning',
            message: '[DUFFEL] API not configured - execution aborted',
          },
        });

        sendMessage({
          type: 'error',
          data: {
            message: 'Duffel API key not configured. Please add DUFFEL_API_KEY to environment variables.',
          },
        });

        controller.close();
        return;
      }

      sendMessage({
        type: 'log',
        data: {
          level: 'success',
          message: '[DUFFEL] Live API authenticated',
        },
      });

      sendMessage({
        type: 'log',
        data: {
          level: 'info',
          message: `[CONFIG] Carrier: ${originalCarrier} | Route: ${origin}-${destination} | Nights: ${minNights}-${maxNights}`,
        },
      });

      const startDate = new Date(searchWindowStart);
      const endDate = new Date(searchWindowEnd);

      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      const phase1Calls = Math.floor(maxApiCalls / 2);
      const phase2Calls = maxApiCalls - phase1Calls;

      sendMessage({
        type: 'log',
        data: {
          level: 'info',
          message: `[PROBE PHASE] Exploring ${phase1Calls} sparse dates across ${totalDays} day window`,
        },
      });

      const phase1Dates = generateSparseDates(startDate, endDate, phase1Calls);

      const phase1Results: { date: Date; bestPrice: number; bestYield: number }[] = [];

      try {
        for (const probeDate of phase1Dates) {
          if (totalApiCalls >= maxApiCalls) break;

          const departureDate = probeDate.toISOString().split('T')[0];

          for (let nights = minNights; nights <= maxNights; nights++) {
            if (totalApiCalls >= maxApiCalls) break;

            const returnDate = addDays(probeDate, nights).toISOString().split('T')[0];

            if (new Date(returnDate) > endDate) continue;

            totalApiCalls++;

            sendMessage({
              type: 'log',
              data: {
                level: 'info',
                message: `[PROBE ${totalApiCalls}/${phase1Calls}] ${departureDate} (${nights}N)`,
              },
            });

            try {
              const searchResult: SearchResult = await searchDuffelOffers({
                origin,
                destination,
                departureDate,
                returnDate,
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

              const { candidates, rawOffersCount, rejectedCount } = searchResult;

              totalScanned += rawOffersCount;
              outOfRange += rejectedCount;

              sendMessage({
                type: 'metrics',
                data: {
                  totalScanned,
                  candidatesFound,
                  outOfRange,
                  progress: `${totalApiCalls}/${maxApiCalls}`,
                  phase: 'PROBE',
                },
              });

              let bestPrice = Infinity;
              let bestYield = Infinity;

              for (const candidate of candidates) {
                const isVerified = candidate.status === 'verified';
                
                if (isVerified) {
                  candidatesFound++;
                  sendMessage({
                    type: 'log',
                    data: {
                      level: 'success',
                      message: `[MATCH] ${candidate.carrier} ${candidate.departureDate} | ${candidate.nights}N | $${candidate.price.toFixed(2)}`,
                    },
                  });
                } else {
                  outOfRange++;
                }

                sendMessage({
                  type: 'candidate',
                  data: candidate,
                });

                if (candidate.price < bestPrice) {
                  bestPrice = candidate.price;
                  bestYield = candidate.yieldDelta;
                }
              }

              if (bestPrice < Infinity) {
                phase1Results.push({
                  date: probeDate,
                  bestPrice,
                  bestYield,
                });
              }

            } catch (searchError) {
              sendMessage({
                type: 'log',
                data: {
                  level: 'warning',
                  message: `[ERROR] ${departureDate}: ${searchError instanceof Error ? searchError.message : 'Unknown'}`,
                },
              });
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        let bestProbeDate = startDate;
        if (phase1Results.length > 0) {
          const bestResult = phase1Results.reduce((best, current) => 
            current.bestPrice < best.bestPrice ? current : best
          );
          bestProbeDate = bestResult.date;
        }

        sendMessage({
          type: 'log',
          data: {
            level: 'success',
            message: `[PROBE COMPLETE] Best date: ${bestProbeDate.toISOString().split('T')[0]} ($${phase1Results.find(r => r.date.getTime() === bestProbeDate.getTime())?.bestPrice.toFixed(2) || 'N/A'})`,
          },
        });

        sendMessage({
          type: 'log',
          data: {
            level: 'info',
            message: `[EXTRACTION PHASE] Dense scanning ${phase2Calls} dates around ${bestProbeDate.toISOString().split('T')[0]}`,
          },
        });

        const phase2Dates = generateDenseDates(bestProbeDate, phase2Calls, Math.floor(phase2Calls / 4));

        for (const denseDate of phase2Dates) {
          if (totalApiCalls >= maxApiCalls) break;

          const departureDate = denseDate.toISOString().split('T')[0];

          for (let nights = minNights; nights <= maxNights; nights++) {
            if (totalApiCalls >= maxApiCalls) break;

            const returnDate = addDays(denseDate, nights).toISOString().split('T')[0];

            if (new Date(returnDate) > endDate) continue;

            totalApiCalls++;

            sendMessage({
              type: 'log',
              data: {
                level: 'info',
                message: `[EXTRACT ${totalApiCalls}/${maxApiCalls}] ${departureDate} (${nights}N)`,
              },
            });

            try {
              const searchResult: SearchResult = await searchDuffelOffers({
                origin,
                destination,
                departureDate,
                returnDate,
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

              const { candidates, rawOffersCount, rejectedCount } = searchResult;

              totalScanned += rawOffersCount;
              outOfRange += rejectedCount;

              sendMessage({
                type: 'metrics',
                data: {
                  totalScanned,
                  candidatesFound,
                  outOfRange,
                  progress: `${totalApiCalls}/${maxApiCalls}`,
                  phase: 'EXTRACT',
                },
              });

              for (const candidate of candidates) {
                const isVerified = candidate.status === 'verified';
                
                if (isVerified) {
                  candidatesFound++;
                  sendMessage({
                    type: 'log',
                    data: {
                      level: 'success',
                      message: `[MATCH!] ${candidate.carrier} ${candidate.departureDate} | ${candidate.nights}N | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`,
                    },
                  });
                } else {
                  outOfRange++;
                }

                sendMessage({
                  type: 'candidate',
                  data: candidate,
                });
              }

            } catch (searchError) {
              sendMessage({
                type: 'log',
                data: {
                  level: 'warning',
                  message: `[ERROR] ${departureDate}: ${searchError instanceof Error ? searchError.message : 'Unknown'}`,
                },
              });
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        sendMessage({
          type: 'log',
          data: {
            level: 'success',
            message: `[COMPLETE] Scanned: ${totalScanned} | Matches: ${candidatesFound} | Out of Range: ${outOfRange}`,
          },
        });

        sendMessage({
          type: 'complete',
          data: {
            totalScanned,
            candidatesFound,
            outOfRange,
            totalApiCalls,
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
      Connection: 'keep-alive',
    },
  });
}
