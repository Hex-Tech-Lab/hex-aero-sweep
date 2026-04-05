import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
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
}

let redis: Redis | null = null;

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

function getCacheKey(search: ChunkSearch, origin: string, destination: string): string {
  return `${origin}-${destination}-${search.departureDate}-${search.returnDate}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChunkRequest = await request.json();
    const { searches, origin, destination, cabinClass, passengerCount, baseCost, priceTolerance, originalCarrier, directFlightOnly } = body;

    if (!searches || !Array.isArray(searches)) {
      return NextResponse.json({ error: 'Invalid request: searches array required' }, { status: 400 });
    }

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

    // Parallel execution: process all searches simultaneously
    const searchPromises = searches.map(async (search) => {
      const cacheKey = getCacheKey(search, origin, destination);
      
      // Try cache first
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
      
      // Cache miss - fetch from Duffel
      cacheMisses++;
      try {
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
        });

        const filteredCandidates: FlightCandidate[] = [];
        const rejectedByBreaker: { carrier: string; departureDate: string; trueCost: number; tierPenalty: number }[] = [];
        
        for (const candidate of result.candidates) {
          const tierPenalty = candidate.metadata?.tierPenalty || 0;
          const trueCost = candidate.price + tierPenalty;
          
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
        
        // Store in cache (24 hour expiry)
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
    });

  } catch (error) {
    console.error('[Chunk API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
