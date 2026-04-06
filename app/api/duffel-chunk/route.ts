import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { searchDuffelOffers, FlightCandidate, OriginalTicketData } from '@/lib/duffel-service';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface ChunkSearch {
  departureDate: string;
  returnDate: string;
}

interface ChunkRequest {
  searches: ChunkSearch[];
  origin: string;
  destination: string;
  cabinClass: string;
  passengerCount: number;
  baseCost: number;
  priceTolerance: number;
  originalCarrier: string;
  directFlightOnly?: boolean;
  fareFamilyCache?: Record<string, any>;
  anchorFamilyId?: string | null;
  anchorTier?: number | null;
  passengerAdults?: number;
  passengerChildren?: number;
}

interface FinalizeRequest {
  _action: 'finalize';
  jobId: string;
  results: any[];
  baseCost: number;
  finalStatus: string;
  totalScanned: number;
  candidatesFound: number;
}

let redis: Redis | null = null;
let supabaseService: SupabaseClient | null = null;

function getRedisClient(): Redis | null {
  if (redis) return redis;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (url && token) {
    redis = new Redis({ url, token });
    return redis;
  }
  
  return null;
}

function getServiceRoleClient(): SupabaseClient | null {
  if (supabaseService) return supabaseService;
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (supabaseUrl && serviceRoleKey) {
    supabaseService = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return supabaseService;
  }
  
  return null;
}

function getCacheKey(
  search: ChunkSearch,
  origin: string,
  destination: string,
  anchorTier: number | null | undefined,
  passengerAdults: number | undefined,
  passengerChildren: number | undefined
): string {
  const tier = anchorTier ?? 0;
  const adults = passengerAdults ?? 1;
  const children = passengerChildren ?? 0;
  return `${origin}-${destination}-${search.departureDate}-${search.returnDate}-N${tier}-A${adults}-C${children}`;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let body: ChunkRequest | FinalizeRequest;

    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 400 });
    }

    if ('_action' in body && body._action === 'finalize') {
      return handleFinalize(body as FinalizeRequest);
    }

    const chunkBody = body as ChunkRequest;
    const { searches, origin, destination, cabinClass, passengerCount, originalCarrier, directFlightOnly } = chunkBody;

    if (!searches || !Array.isArray(searches)) {
      return NextResponse.json({ error: 'Invalid request: searches array required' }, { status: 400 });
    }

    const baseCost = Number(chunkBody.baseCost);
    const priceTolerance = Number(chunkBody.priceTolerance);
    const maxAcceptablePrice = baseCost + priceTolerance;
    
    const originalTicketData: OriginalTicketData = {
      carrier: originalCarrier,
      origin,
      destination,
      routeLegs: [{ from: origin, to: destination }],
      departureDate: searches[0]?.departureDate,
    };

    const redisClient = getRedisClient();
    let cacheHits = 0;
    let cacheMisses = 0;

    const results: {
      candidates: FlightCandidate[];
      rawOffersCount: number;
      rejectedCount: number;
      departureDate: string;
      fromCache?: boolean;
    }[] = [];

    const searchPromises = searches.map(async (search) => {
      const cacheKey = getCacheKey(
        search,
        origin,
        destination,
        chunkBody.anchorTier,
        chunkBody.passengerAdults,
        chunkBody.passengerChildren
      );
      
      if (redisClient) {
        try {
          const cached = await redisClient.get<string>(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            cacheHits++;
            return {
              candidates: parsed.candidates || [],
              rawOffersCount: parsed.rawOffersCount || 0,
              rejectedCount: parsed.rejectedCount || 0,
              departureDate: search.departureDate,
              fromCache: true,
            };
          }
        } catch (cacheErr) {
          console.warn(`[Cache] Redis GET failed for ${cacheKey}:`, cacheErr);
        }
      }
      
      cacheMisses++;
      try {
        const fareFamilyCacheMap = chunkBody.fareFamilyCache
          ? new Map(Object.entries(chunkBody.fareFamilyCache))
          : undefined;

        const result = await searchDuffelOffers({
          origin,
          destination,
          departureDate: search.departureDate,
          returnDate: search.returnDate,
          passengers: passengerCount,
          cabinClass: cabinClass as any,
          originalTicket: originalTicketData,
          baseCost,
          preferences: {
            directFlightOnly,
            outboundTimePreference: 'any',
            inboundTimePreference: 'any',
          },
          fareFamilyCache: fareFamilyCacheMap,
          anchorFamilyId: chunkBody.anchorFamilyId,
          anchorTier: chunkBody.anchorTier,
          passengerAdults: chunkBody.passengerAdults,
          passengerChildren: chunkBody.passengerChildren,
        });

        const filteredCandidates: FlightCandidate[] = [];
        const rejectedByBreaker: { carrier: string; departureDate: string; trueCost: number; tierPenalty: number }[] = [];
        
        for (const candidate of result.candidates) {
          const tierPenalty = Number(candidate.metadata?.tierPenalty) || 0;
          const trueCost = Number(candidate.price) + tierPenalty;
          
          if (trueCost <= maxAcceptablePrice) {
            filteredCandidates.push(candidate);
          } else if (tierPenalty > 0) {
            rejectedByBreaker.push({ carrier: candidate.carrier, departureDate: candidate.departureDate, trueCost, tierPenalty });
          }
        }
        
        if (rejectedByBreaker.length > 0) {
          console.warn(`[INCINERATOR] ${rejectedByBreaker.length} candidates rejected by Circuit Breaker due to tier penalties`);
          rejectedByBreaker.slice(0, 3).forEach(r => {
            console.warn(`[REJECTED] ${r.carrier} ${r.departureDate} | True Cost $${r.trueCost.toFixed(2)} exceeds target due to +$${r.tierPenalty.toFixed(0)} tier penalty`);
          });
        }
        
        const response = {
          candidates: filteredCandidates,
          rawOffersCount: result.rawOffersCount,
          rejectedCount: result.rejectedCount,
        };
        
        if (redisClient) {
          try {
            await redisClient.set(cacheKey, JSON.stringify(response), { ex: 86400 });
          } catch (cacheSetErr) {
            console.warn(`[Cache] Redis SET failed for ${cacheKey}:`, cacheSetErr);
          }
        }
        
        return {
          candidates: filteredCandidates,
          rawOffersCount: result.rawOffersCount,
          rejectedCount: result.rejectedCount,
          departureDate: search.departureDate,
          fromCache: false,
        };
      } catch (err) {
        console.error(`[Chunk API] Search failed for ${search.departureDate}:`, err);
        return {
          candidates: [],
          rawOffersCount: 0,
          rejectedCount: 0,
          departureDate: search.departureDate,
          fromCache: false,
        };
      }
    });

    const searchResults = await Promise.all(searchPromises);
    results.push(...searchResults);

    console.log(`[Chunk API] Cache: ${cacheHits} hits, ${cacheMisses} misses`);

    return NextResponse.json({
      success: true,
      results,
      maxAcceptablePrice,
      cacheStats: { hits: cacheHits, misses: cacheMisses },
      _isCacheHit: cacheHits > 0 && cacheMisses === 0,
    });

  } catch (error) {
    console.error('[Chunk API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleFinalize(body: FinalizeRequest) {
  const { jobId, results, baseCost, finalStatus, totalScanned, candidatesFound } = body;

  console.log(`[Chunk API] Finalize action for job ${jobId}: ${results.length} results`);

  const supabase = getServiceRoleClient();
  if (!supabase) {
    console.error('[Chunk API] Service role client unavailable');
    return NextResponse.json({ error: 'Database client unavailable' }, { status: 503 });
  }

  try {
    await supabase.rpc('update_search_job', {
      p_job_id: jobId,
      p_status: finalStatus,
      p_total_scanned: totalScanned,
      p_candidates_found: candidatesFound,
      p_completed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[Chunk API] Failed to update search job status:', err);
  }

  if (results.length === 0) {
    return NextResponse.json({ success: true, persisted: 0 });
  }

  const searchResultRows = results.map((c: any) => ({
    job_id: jobId,
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

  const BATCH_SIZE = 50;
  let persistedCount = 0;

  for (let i = 0; i < searchResultRows.length; i += BATCH_SIZE) {
    const batch = searchResultRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('search_results')
      .insert(batch);

    if (error) {
      console.error(`[Chunk API] search_results batch insert failed:`, error);
    } else {
      persistedCount += batch.length;
    }
  }

  const calendarMap = new Map<string, any>();
  for (const c of results) {
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

  const calendarRows = Array.from(calendarMap.values()).map((c: any) => ({
    job_id: jobId,
    outbound_date: c.departureDate,
    nights: c.nights,
    cheapest_raw: c.price,
    cheapest_normalized: c.price + (c.metadata?.tierPenalty || 0),
    fare_family: c.resolvedFamilyName || 'Unknown',
    booking_class: c.bookingClass || 'Y',
    data_source: 'DUFFEL' as const,
    confidence: null,
  }));

  if (calendarRows.length > 0) {
    const { error } = await supabase
      .from('price_calendar')
      .upsert(calendarRows, {
        onConflict: 'job_id,outbound_date,nights',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`[Chunk API] price_calendar upsert failed:`, error);
    }
  }

  console.log(`[Chunk API] Persisted ${persistedCount} results + ${calendarRows.length} calendar entries for job ${jobId}`);

  return NextResponse.json({
    success: true,
    persisted: persistedCount,
    calendarEntries: calendarRows.length,
  });
}
