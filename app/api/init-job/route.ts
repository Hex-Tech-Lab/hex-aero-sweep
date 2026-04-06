import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CreateSearchJobParams, CreateSearchJobResult } from '@/types/supabase';

export const runtime = 'nodejs';
export const maxDuration = 10;

interface InitJobRequest {
  ticketId: string;
  pnr: string;
  carrierIata: string;
  bookingClass: string;
  originIata: string;
  destIata: string;
  fareFamilyId: string | null;
  parityTier: number | null;
  anchorBaseCost: number;
  searchWindowStart: string;
  searchWindowEnd: string;
  minNights: number;
  maxNights: number;
  priceTolerance: number;
  maxApiCalls: number;
}

function createServiceRoleClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[InitJob API] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL');
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: InitJobRequest = await request.json();

    const requiredFields: (keyof InitJobRequest)[] = [
      'carrierIata', 'bookingClass', 'anchorBaseCost',
      'searchWindowStart', 'searchWindowEnd', 'minNights', 'maxNights'
    ];

    const missingFields = requiredFields.filter(field => {
      const value = body[field];
      return value === undefined || value === null || value === '';
    });

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: 'Missing required fields', missingFields },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Service role client unavailable' },
        { status: 503 }
      );
    }

    const params: CreateSearchJobParams = {
      p_ticket_id: body.ticketId || null,
      p_pnr: body.pnr || null,
      p_carrier_iata: body.carrierIata,
      p_booking_class: body.bookingClass,
      p_fare_family_id: body.fareFamilyId || null,
      p_parity_tier: body.parityTier ?? null,
      p_anchor_base_cost: body.anchorBaseCost,
      p_search_window_start: body.searchWindowStart,
      p_search_window_end: body.searchWindowEnd,
      p_min_nights: body.minNights,
      p_max_nights: body.maxNights,
      p_price_tolerance: body.priceTolerance,
      p_max_api_calls: body.maxApiCalls,
    };

    if (body.originIata && body.destIata) {
      params.p_origin_iata = body.originIata;
      params.p_dest_iata = body.destIata;
    }

    const { data, error } = await supabase.rpc('create_search_job', params);

    if (error) {
      console.error('[InitJob API] RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to create search job', details: error.message },
        { status: 500 }
      );
    }

    const result = data as CreateSearchJobResult;

    if (!result) {
      return NextResponse.json(
        { error: 'No result returned from create_search_job' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    console.log(`[InitJob API] Created job ${result.id} in ${duration}ms`);

    return NextResponse.json({
      success: true,
      jobId: result.id,
      sweepExecutionId: result.sweep_execution_id,
      duration,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[InitJob API] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
