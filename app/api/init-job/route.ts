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

    console.log('[API INIT-JOB] Env Check - URL exists:', !!supabaseUrl);
    console.log('[API INIT-JOB] Env Check - Service Key exists:', !!serviceRoleKey);

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

  console.log('[InitJob API] =========== REQUEST START ===========');
  console.log('[InitJob API] Method:', request.method);
  console.log('[InitJob API] URL:', request.url);

  try {
    let rawBody: string;
    try {
      rawBody = await request.text();
      console.log('[InitJob API] Raw body length:', rawBody.length);
    } catch (e) {
      console.error('[InitJob API] FATAL: Failed to read request body', e);
      return NextResponse.json(
        { error: 'Failed to read request body', details: (e as Error).message },
        { status: 400 }
      );
    }

    let body: InitJobRequest;
    try {
      body = JSON.parse(rawBody);
      console.log('[InitJob API] Parsed body:', body);
    } catch (e) {
      console.error('[InitJob API] FATAL: Failed to parse JSON body', e);
      return NextResponse.json(
        { error: 'Invalid JSON body', details: (e as Error).message },
        { status: 400 }
      );
    }

    const requiredFields: (keyof InitJobRequest)[] = [
      'carrierIata', 'bookingClass', 'anchorBaseCost',
      'searchWindowStart', 'searchWindowEnd', 'minNights', 'maxNights'
    ];

    const missingFields = requiredFields.filter(field => {
      const value = body[field];
      return value === undefined || value === null || value === '';
    });

    console.log('[InitJob API] Validation:', {
      requiredFields,
      missingFields,
      passed: missingFields.length === 0,
      bodyKeys: Object.keys(body),
    });

    if (missingFields.length > 0) {
      console.error('[InitJob API] VALIDATION FAILED:', missingFields);
      return NextResponse.json(
        { error: 'Missing required fields', missingFields },
        { status: 400 }
      );
    }

    console.log('[InitJob API] Creating Supabase client with Service Role key...');
    const supabase = createServiceRoleClient();

    console.log('[InitJob API] Supabase client created:', !!supabase);

    if (!supabase) {
      console.error('[InitJob API] FATAL: Service role client unavailable - SUPABASE_SERVICE_ROLE_KEY missing?');
      return NextResponse.json(
        { error: 'Service role client unavailable', details: 'SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL not configured' },
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

    console.log('[InitJob API] Inserting search_job with params:', {
      p_carrier_iata: params.p_carrier_iata,
      p_booking_class: params.p_booking_class,
      p_origin_iata: params.p_origin_iata,
      p_dest_iata: params.p_dest_iata,
      p_anchor_base_cost: params.p_anchor_base_cost,
    });

    const { data, error } = await supabase.rpc('create_search_job', params);

    if (error) {
      console.error('[InitJob API] RPC call FAILED:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        { error: 'Failed to create search job', details: error.message, code: error.code },
        { status: 500 }
      );
    }

    console.log('[InitJob API] RPC call succeeded, returned data:', data);

    const result = data as CreateSearchJobResult;

    if (!result) {
      console.error('[InitJob API] CRITICAL: RPC returned success but no data');
      return NextResponse.json(
        { error: 'No result returned from create_search_job', details: 'RPC returned null' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    console.log(`[InitJob API] =========== REQUEST END ===========`);
    console.log(`[InitJob API] SUCCESS: Created job ${result.id} in ${duration}ms`);
    console.log(`[InitJob API] Sweep Execution ID: ${result.sweep_execution_id}`);

    return NextResponse.json({
      success: true,
      jobId: result.id,
      sweepExecutionId: result.sweep_execution_id,
      duration,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[InitJob API] =========== REQUEST ERROR ===========');
    console.error('[InitJob API] Unexpected error:', err);
    console.error('[InitJob API] Stack:', err instanceof Error ? err.stack : 'No stack');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
