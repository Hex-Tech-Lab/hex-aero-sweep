import { Duffel } from '@duffel/api';

export interface FlightSegment {
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  carrier: string;
  flightNumber: string;
  duration: string;
}

export interface FlightCandidate {
  id: string;
  carrier: string;
  departureDate: string;
  returnDate: string;
  nights: number;
  price: number;
  yieldDelta: number;
  status: string;
  outboundSegments: FlightSegment[];
  inboundSegments: FlightSegment[];
  metadata: {
    phase: string;
    segments: number;
    bookingClass: string;
    layoverDuration?: string;
  };
}

export interface OriginalTicketData {
  carrier: string;
  origin: string;
  destination: string;
  routeLegs: Array<{ from: string; to: string }>;
}

const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;
let duffelClient: Duffel | null = null;

if (DUFFEL_API_KEY && DUFFEL_API_KEY !== '') {
  try {
    duffelClient = new Duffel({ token: DUFFEL_API_KEY });
  } catch (error) {
    console.warn('[Duffel] Failed to initialize client:', error);
  }
}

export function isDuffelConfigured(): boolean {
  return duffelClient !== null;
}

function matchesCarrier(offerCarrier: string, originalCarrier: string): boolean {
  return offerCarrier === originalCarrier;
}

function matchesRouteTopology(
  offerSegments: any[],
  originalRoute: Array<{ from: string; to: string }>
): boolean {
  if (offerSegments.length !== originalRoute.length) {
    return false;
  }

  for (let i = 0; i < offerSegments.length; i++) {
    const segment = offerSegments[i];
    const routeLeg = originalRoute[i];

    if (
      segment.origin?.iata_code !== routeLeg.from ||
      segment.destination?.iata_code !== routeLeg.to
    ) {
      return false;
    }
  }

  return true;
}

export async function searchDuffelOffers(params: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  passengers: number;
  cabinClass: 'economy' | 'business' | 'first' | 'premium_economy';
  originalTicket?: OriginalTicketData;
  baseCost: number;
}): Promise<FlightCandidate[]> {
  if (!duffelClient) {
    console.warn('[Duffel] Client not configured - skipping search');
    return [];
  }

  console.log('[Duffel] Executing search:', {
    route: `${params.origin} -> ${params.destination}`,
    departure: params.departureDate,
    return: params.returnDate,
    pax: params.passengers,
  });

  try {
    const passengerArray = Array.from({ length: params.passengers }, () => ({
      type: 'adult' as const,
    }));

    const offerRequest = await duffelClient.offerRequests.create({
      slices: [
        {
          origin: params.origin,
          destination: params.destination,
          departure_date: params.departureDate,
        } as any,
        {
          origin: params.destination,
          destination: params.origin,
          departure_date: params.returnDate,
        } as any,
      ],
      passengers: passengerArray as any,
      cabin_class: params.cabinClass,
      return_offers: true,
    } as any);

    const offers = (offerRequest.data as any)?.offers || [];

    console.log(`[Duffel] Retrieved ${offers.length} raw offers from API`);

    const candidates: FlightCandidate[] = [];

    for (const offer of offers) {
      const ownerCarrier = offer.owner?.iata_code;

      if (params.originalTicket && ownerCarrier) {
        if (!matchesCarrier(ownerCarrier, params.originalTicket.carrier)) {
          console.log(`[Duffel] REJECTED: Carrier mismatch (${ownerCarrier} != ${params.originalTicket.carrier})`);
          continue;
        }
      }

      const outboundSlice = offer.slices?.[0];
      const inboundSlice = offer.slices?.[1];

      if (!outboundSlice || !inboundSlice) {
        continue;
      }

      if (params.originalTicket?.routeLegs) {
        if (!matchesRouteTopology(outboundSlice.segments, params.originalTicket.routeLegs)) {
          console.log('[Duffel] REJECTED: Route topology mismatch');
          continue;
        }
      }

      const price = parseFloat(offer.total_amount);
      const yieldDelta = price - params.baseCost;

      const outboundSegments: FlightSegment[] = outboundSlice.segments.map((seg: any) => ({
        origin: seg.origin?.iata_code || '',
        destination: seg.destination?.iata_code || '',
        departureTime: seg.departing_at || '',
        arrivalTime: seg.arriving_at || '',
        carrier: seg.marketing_carrier?.iata_code || '',
        flightNumber: seg.marketing_carrier_flight_number || '',
        duration: seg.duration || '',
      }));

      const inboundSegments: FlightSegment[] = inboundSlice.segments.map((seg: any) => ({
        origin: seg.origin?.iata_code || '',
        destination: seg.destination?.iata_code || '',
        departureTime: seg.departing_at || '',
        arrivalTime: seg.arriving_at || '',
        carrier: seg.marketing_carrier?.iata_code || '',
        flightNumber: seg.marketing_carrier_flight_number || '',
        duration: seg.duration || '',
      }));

      const departureDate = outboundSlice.segments[0]?.departing_at?.split('T')[0] || params.departureDate;
      const returnDate = inboundSlice.segments[0]?.departing_at?.split('T')[0] || params.returnDate;

      const nights = Math.floor(
        (new Date(returnDate).getTime() - new Date(departureDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      candidates.push({
        id: offer.id,
        carrier: ownerCarrier || 'XX',
        departureDate,
        returnDate,
        nights,
        price,
        yieldDelta: Math.round(yieldDelta * 100) / 100,
        status: 'verified',
        outboundSegments,
        inboundSegments,
        metadata: {
          phase: 'LIVE DUFFEL',
          segments: outboundSlice.segments.length,
          bookingClass: outboundSlice.fare_brand_name || offer.cabin_class || 'Y',
        },
      });
    }

    console.log(`[Duffel] Filtered to ${candidates.length} matching candidates`);

    return candidates;
  } catch (error: any) {
    console.error('[Duffel] API error:', error.message || error);
    return [];
  }
}

export async function testDuffelConnection(): Promise<{ success: boolean; message: string }> {
  if (!duffelClient) {
    return { success: false, message: 'Duffel API key not configured' };
  }

  try {
    const testDate = new Date();
    testDate.setDate(testDate.getDate() + 30);
    const testDateStr = testDate.toISOString().split('T')[0];

    const returnDate = new Date(testDate);
    returnDate.setDate(returnDate.getDate() + 7);
    const returnDateStr = returnDate.toISOString().split('T')[0];

    const testRequest = await duffelClient.offerRequests.create({
      slices: [
        {
          origin: 'LHR',
          destination: 'JFK',
          departure_date: testDateStr,
        } as any,
        {
          origin: 'JFK',
          destination: 'LHR',
          departure_date: returnDateStr,
        } as any,
      ],
      passengers: [{ type: 'adult' }] as any,
      cabin_class: 'economy',
      return_offers: true,
    } as any);

    const offerCount = (testRequest.data as any)?.offers?.length || 0;

    return {
      success: true,
      message: `Duffel API connected successfully. Test query returned ${offerCount} offers.`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Duffel API connection failed: ${error.message || 'Unknown error'}`,
    };
  }
}
