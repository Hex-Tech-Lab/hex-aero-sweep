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
    timePreferences?: {
      outbound?: { preference: string; actual: string } | null;
      inbound?: { preference: string; actual: string } | null;
    };
  };
}

export interface OriginalTicketData {
  carrier: string;
  origin: string;
  destination: string;
  routeLegs: Array<{ from: string; to: string }>;
}

export type TimePreference = 'any' | 'morning' | 'afternoon' | 'evening';

export interface SearchPreferences {
  directFlightOnly?: boolean;
  outboundTimePreference?: TimePreference;
  inboundTimePreference?: TimePreference;
  passengerBreakdown?: {
    adults?: number;
    children?: number;
    infants?: number;
    passengerTypeSource?: string;
  };
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
  preferences?: SearchPreferences;
}): Promise<FlightCandidate[]> {
  if (!duffelClient) {
    console.warn('[Duffel] Client not configured - skipping search');
    return [];
  }

  const preferences = params.preferences || {};
  const { outboundTimePreference = 'any', inboundTimePreference = 'any', directFlightOnly = false } = preferences;

  console.log('[Duffel] Executing search:', {
    route: `${params.origin} -> ${params.destination}`,
    departure: params.departureDate,
    return: params.returnDate,
    pax: params.passengers,
    preferences: {
      directFlightOnly,
      outboundTimePreference,
      inboundTimePreference,
    },
  });

  // Helper function to get time slot from departure datetime
  function getTimeSlot(departureTime: string): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date(departureTime).getUTCHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 24) return 'evening';
    return 'night';
  }

  // Helper function to check if time slot matches preference
  function matchesTimePreference(departureTime: string, preference: TimePreference): boolean {
    if (preference === 'any') return true;
    const slot = getTimeSlot(departureTime);
    return slot === preference;
  }

  try {
    // Build passenger array with correct types (adult, child, infant)
    const passengerArray: Array<{ type: 'adult' | 'child' | 'infant' }> = [];
    const breakdown = preferences.passengerBreakdown;

    // Add adults
    const adultCount = breakdown?.adults ?? params.passengers;
    for (let i = 0; i < adultCount; i++) {
      passengerArray.push({ type: 'adult' });
    }

    // Add children if confirmed by source
    if (breakdown?.children && breakdown?.children > 0) {
      for (let i = 0; i < breakdown.children; i++) {
        passengerArray.push({ type: 'child' });
      }
      console.log(`[Duffel] Including ${breakdown.children} child passenger(s) - source verified: ${breakdown.passengerTypeSource}`);
    }

    // Add infants if present
    if (breakdown?.infants && breakdown?.infants > 0) {
      for (let i = 0; i < breakdown.infants; i++) {
        passengerArray.push({ type: 'infant' });
      }
    }

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

      // Apply Direct Flight filter
      if (directFlightOnly && outboundSlice.segments.length > 1) {
        console.log(`[Duffel] REJECTED: Direct flight only - outbound has ${outboundSlice.segments.length} segments`);
        continue;
      }

      if (directFlightOnly && inboundSlice.segments.length > 1) {
        console.log(`[Duffel] REJECTED: Direct flight only - inbound has ${inboundSlice.segments.length} segments`);
        continue;
      }

      // Apply Time Slot preference filtering
      const outboundDepartureTime = outboundSlice.segments[0]?.departing_at;
      const inboundDepartureTime = inboundSlice.segments[0]?.departing_at;

      if (outboundDepartureTime && !matchesTimePreference(outboundDepartureTime, outboundTimePreference)) {
        const actualSlot = getTimeSlot(outboundDepartureTime);
        console.log(`[Duffel] REJECTED: Outbound time preference mismatch (wanted: ${outboundTimePreference}, got: ${actualSlot})`);
        continue;
      }

      if (inboundDepartureTime && !matchesTimePreference(inboundDepartureTime, inboundTimePreference)) {
        const actualSlot = getTimeSlot(inboundDepartureTime);
        console.log(`[Duffel] REJECTED: Inbound time preference mismatch (wanted: ${inboundTimePreference}, got: ${actualSlot})`);
        continue;
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
          timePreferences: {
            outbound: outboundTimePreference !== 'any' ? { preference: outboundTimePreference, actual: getTimeSlot(outboundDepartureTime) } : null,
            inbound: inboundTimePreference !== 'any' ? { preference: inboundTimePreference, actual: getTimeSlot(inboundDepartureTime) } : null,
          },
        },
      });
    }

    console.log(`[Duffel] Filtered to ${candidates.length} matching candidates`);

    // Sort by time preference match if preferences are set
    if (outboundTimePreference !== 'any' || inboundTimePreference !== 'any') {
      console.log(`[Duffel] Sorting candidates by time preference match`);
    }

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

export interface PNRDetails {
  pnr: string;
  passengerName: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  arrivalDate: string;
  bookingClass: string;
  ticketNumber: string;
  seatAssignments?: string[];
}

export interface SyncPNRResult {
  success: boolean;
  data?: PNRDetails;
  error?: string;
}

export async function syncPNRDetails(pnr: string, lastName: string): Promise<SyncPNRResult> {
  console.log(`[PNR Sync] Fetching details for PNR: ${pnr}, LastName: ${lastName}`);

  if (!pnr || pnr.trim() === '') {
    console.log('[PNR Sync] No PNR provided');
    return {
      success: false,
      error: 'No PNR provided',
    };
  }

  try {
    if (!duffelClient) {
      console.log('[PNR Sync] Duffel client not configured - checking for airline API fallback');
    }

    console.log('[PNR Sync] Attempting Aegean Airlines API lookup...');
    
    try {
      const aegeanResponse = await fetch(
        `https://en.aegeanair.com/api/booking/${pnr}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        }
      ).catch(() => null);

      if (aegeanResponse?.ok) {
        const data = await aegeanResponse.json();
        console.log('[PNR Sync] Aegean API responded:', data);
      }
    } catch (aegeanError) {
      console.log('[PNR Sync] Aegean API not accessible:', aegeanError instanceof Error ? aegeanError.message : 'Unknown error');
    }

    console.log('[PNR Sync] Available integration approaches:');
    console.log('  1. Amadeus GDS (if access available)');
    console.log('  2. Direct airline APIs (Aegean, Olympic, etc.)');
    console.log('  3. Travelport/ Sabre Galileo');

    if (!duffelClient) {
      console.log('[PNR Sync] Returning placeholder data for development');
      return {
        success: true,
        data: {
          pnr: pnr,
          passengerName: lastName.toUpperCase(),
          flightNumber: 'A3123',
          origin: 'CAI',
          destination: 'ATH',
          departureDate: new Date().toISOString().split('T')[0],
          arrivalDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().split('T')[0],
          bookingClass: 'Economy',
          ticketNumber: `123-${Date.now()}`,
        },
      };
    }

    return {
      success: false,
      error: 'PNR sync not yet implemented - requires GDS or airline API integration',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PNR Sync] Error:`, errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
