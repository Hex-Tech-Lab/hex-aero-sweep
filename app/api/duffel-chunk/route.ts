import { NextRequest, NextResponse } from 'next/server';
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

    const results: {
      candidates: FlightCandidate[];
      rawOffersCount: number;
      rejectedCount: number;
      departureDate: string;
    }[] = [];

    // Parallel execution: process all searches simultaneously
    const searchPromises = searches.map(async (search) => {
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

        const filteredCandidates = result.candidates.filter(c => c.price <= maxAcceptablePrice);
        
        return {
          candidates: filteredCandidates,
          rawOffersCount: result.rawOffersCount,
          rejectedCount: result.rejectedCount,
          departureDate: search.departureDate,
        };
      } catch (err) {
        console.error(`[Chunk API] Search failed for ${search.departureDate}:`, err);
        return {
          candidates: [],
          rawOffersCount: 0,
          rejectedCount: 0,
          departureDate: search.departureDate,
        };
      }
    });

    const searchResults = await Promise.all(searchPromises);
    results.push(...searchResults);

    return NextResponse.json({
      success: true,
      results,
      maxAcceptablePrice,
    });

  } catch (error) {
    console.error('[Chunk API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
