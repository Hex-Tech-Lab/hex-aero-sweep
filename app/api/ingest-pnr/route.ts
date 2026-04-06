import { NextRequest, NextResponse } from 'next/server';
import { Duffel } from '@duffel/api';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface IngestPNRRequest {
  pnr: string;
  lastName: string;
}

interface OrderPassenger {
  id: string;
  given_name: string;
  family_name: string;
  title: string;
}

interface OrderSliceSegment {
  origin: { iata_code: string; name: string };
  destination: { iata_code: string; name: string };
  departing_at: string;
  arriving_at: string;
  carrier: { iata_code: string; name: string };
  flight_number: string;
  cabin_class: string;
  fare_brand_name?: string;
}

interface OrderSlice {
  id: string;
  segments: OrderSliceSegment[];
  origin_type: string;
  destination_type: string;
}

interface OrderPassengerInfo {
  id: string;
  given_name: string;
  family_name: string;
  title: string;
}

function createDuffelClient(): Duffel | null {
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) {
    console.error('[ingest-pnr] DUFFEL_API_KEY not configured');
    return null;
  }
  return new Duffel({ token: apiKey });
}

function extractBookingClass(fareBasisCode?: string): string {
  if (!fareBasisCode) return 'Y';
  return fareBasisCode.charAt(0).toUpperCase() || 'Y';
}

function extractPassengers(passengers: OrderPassengerInfo[]): {
  adults: number;
  children: number;
  infants: number;
} {
  let adults = 0;
  let children = 0;
  let infants = 0;

  for (const p of passengers) {
    const fullName = `${p.given_name} ${p.family_name}`.toLowerCase();
    if (fullName.includes('infant')) {
      infants++;
    } else if (p.title && ['master', 'miss', 'mstr'].includes(p.title.toLowerCase())) {
      children++;
    } else {
      adults++;
    }
  }

  return { adults: adults || 1, children, infants };
}

export async function POST(request: NextRequest) {
  console.log('[ingest-pnr] =========== REQUEST START ===========');

  try {
    const body: IngestPNRRequest = await request.json();
    const { pnr, lastName } = body;

    console.log('[ingest-pnr] Received request:', { pnr, lastName });

    if (!pnr || pnr.trim() === '') {
      return NextResponse.json(
        { error: 'PNR is required' },
        { status: 400 }
      );
    }

    const duffel = createDuffelClient();
    if (!duffel) {
      return NextResponse.json(
        { error: 'Duffel API not configured', details: 'DUFFEL_API_KEY missing' },
        { status: 503 }
      );
    }

    console.log('[ingest-pnr] Fetching order from Duffel:', pnr);

    let orderData: any;
    try {
      const orderResponse = await duffel.orders.get(pnr);
      orderData = orderResponse.data;
      console.log('[ingest-pnr] Duffel response received:', {
        orderId: orderData.id,
        status: orderData.status,
        passengerCount: orderData.passengers?.length,
        sliceCount: orderData.slices?.length,
      });
    } catch (orderError: any) {
      console.error('[ingest-pnr] Duffel order fetch failed:', {
        status: orderError.status,
        message: orderError.message,
        code: orderError.code,
      });

      if (orderError.status === 404 || orderError.code === 'orders_not_found') {
        return NextResponse.json(
          { error: 'Order not found', details: 'PNR not found in Duffel system' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to fetch order', details: orderError.message },
        { status: 502 }
      );
    }

    if (!orderData || !orderData.slices || orderData.slices.length === 0) {
      return NextResponse.json(
        { error: 'Invalid order data', details: 'Order has no flight slices' },
        { status: 422 }
      );
    }

    const outboundSlice = orderData.slices[0];
    const returnSlice = orderData.slices.length > 1 ? orderData.slices[1] : null;

    const originIata = outboundSlice.segments[0]?.origin?.iata_code;
    const destIata = outboundSlice.segments[outboundSlice.segments.length - 1]?.destination?.iata_code;
    const carrierIata = outboundSlice.segments[0]?.carrier?.iata_code;

    if (!originIata || !destIata || !carrierIata) {
      return NextResponse.json(
        { error: 'Incomplete route data', details: 'Missing origin, destination, or carrier' },
        { status: 422 }
      );
    }

    const firstSegment = outboundSlice.segments[0];
    const fareBasisCode = firstSegment?.passengers?.[0]?.fare_basis_code || '';
    const bookingClass = extractBookingClass(fareBasisCode);

    const outboundDeparture = firstSegment?.departing_at?.split('T')[0] || '';
    const returnDeparture = returnSlice?.segments[0]?.departing_at?.split('T')[0] || '';

    const passengers = extractPassengers(orderData.passengers || []);

    const routeLegs = orderData.slices.flatMap((slice: OrderSlice) =>
      slice.segments.map((seg) => ({
        from: seg.origin.iata_code,
        to: seg.destination.iata_code,
      }))
    );

    const ticket: Record<string, any> = {
      pnr: pnr,
      carrier: carrierIata,
      origin: originIata,
      destination: destIata,
      routeLegs,
      bookingClass,
      fareBasisCode,
      departureDate: outboundDeparture,
      returnDate: returnDeparture,
      passengers,
      mode: 'REBOOK',
      rawOrderData: {
        orderId: orderData.id,
        status: orderData.status,
        cabinClass: firstSegment?.cabin_class || 'economy',
        fareBrand: firstSegment?.fare_brand_name,
        totalAmount: orderData.total_amount,
        currency: orderData.total_currency,
        createdAt: orderData.created_at,
      },
    };

    console.log('[ingest-pnr] =========== REQUEST END ===========');
    console.log('[ingest-pnr] Extracted ticket:', {
      pnr: ticket.pnr,
      carrier: ticket.carrier,
      route: `${ticket.origin}-${ticket.destination}`,
      bookingClass: ticket.bookingClass,
      departureDate: ticket.departureDate,
    });

    return NextResponse.json({
      success: true,
      ticket,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ingest-pnr] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
