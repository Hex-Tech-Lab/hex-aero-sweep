import { NextRequest } from 'next/server';
import { updateSearchLog } from '@/lib/supabase-operations';
import { searchDuffelOffers, isDuffelConfigured, FlightCandidate, OriginalTicketData } from '@/lib/duffel-service';

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
  const passengers = parseInt(searchParams.get('passengers') || '1');
  const fareClass = (searchParams.get('fareClass') || 'ECONOMY').toLowerCase();
  const passengerCount = parseInt(searchParams.get('passengers') || '1');

  // Rebooking mode preferences
  const directFlightOnly = searchParams.get('directFlightOnly') === 'true';
  const outboundTimePreference = searchParams.get('outboundTimePreference') || 'any';
  const inboundTimePreference = searchParams.get('inboundTimePreference') || 'any';

  // Passenger breakdown for child discount verification
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
          message: '[DUFFEL] Live API authenticated - enforcing strict carrier matching',
        },
      });

      sendMessage({
        type: 'log',
        data: {
          level: 'info',
          message: `[CONFIG] Carrier Filter: ${originalCarrier} | Route: ${origin}-${destination}`,
        },
      });

      const startDate = new Date(searchWindowStart);
      const endDate = new Date(searchWindowEnd);

      let currentDate = new Date(startDate);

      try {
        while (currentDate <= endDate && totalApiCalls < maxApiCalls) {
          const departureDate = currentDate.toISOString().split('T')[0];

          for (let nights = minNights; nights <= maxNights; nights++) {
            if (totalApiCalls >= maxApiCalls) break;

            const returnDate = addDays(currentDate, nights).toISOString().split('T')[0];

            if (new Date(returnDate) > endDate) continue;

            totalApiCalls++;

            sendMessage({
              type: 'log',
              data: {
                level: 'info',
                message: `[CALL ${totalApiCalls}/${maxApiCalls}] Querying: ${departureDate} -> ${returnDate} (${nights}N)`,
              },
            });

            try {
              const candidates = await searchDuffelOffers({
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

              if (DEVELOPER_VERBOSE_MODE && candidates.length > 0) {
                sendMessage({
                  type: 'duffel_payload',
                  data: {
                    query: { origin, destination, departureDate, returnDate },
                    candidatesReturned: candidates.length,
                    rawPayload: candidates,
                  },
                });
              }

              totalScanned += candidates.length;

              for (const candidate of candidates) {
                const withinTolerance = Math.abs(candidate.yieldDelta) <= priceTolerance;

                if (withinTolerance) {
                  candidatesFound++;

                  sendMessage({
                    type: 'candidate',
                    data: candidate,
                  });

                  sendMessage({
                    type: 'log',
                    data: {
                      level: 'success',
                      message: `[MATCH] ${candidate.carrier} ${candidate.departureDate} | ${candidate.nights}N | $${candidate.price.toFixed(2)} (Δ$${candidate.yieldDelta.toFixed(2)})`,
                    },
                  });
                } else {
                  outOfRange++;
                }
              }

              sendMessage({
                type: 'metrics',
                data: {
                  totalScanned,
                  candidatesFound,
                  outOfRange,
                },
              });

            } catch (searchError) {
              sendMessage({
                type: 'log',
                data: {
                  level: 'warning',
                  message: `[ERROR] Query failed for ${departureDate}: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
                },
              });
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          currentDate = addDays(currentDate, 1);

          if (totalApiCalls % 5 === 0) {
            sendMessage({
              type: 'log',
              data: {
                level: 'warning',
                message: `>>> PHASE SHIFT: DATE FLEX (${currentDate.toISOString().split('T')[0]}) <<<`,
              },
            });
          }
        }

        sendMessage({
          type: 'log',
          data: {
            level: 'success',
            message: `[COMPLETE] Sweep finished. Scanned: ${totalScanned} | Matches: ${candidatesFound} | API Calls: ${totalApiCalls}`,
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
