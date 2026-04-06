import { supabase } from '@/lib/supabase';
import type { FareFamilyCache, FareFamilyRow } from '@/types/airline';

const ECONOMY_BOOKING_CLASSES = ['Y', 'B', 'M', 'H', 'Q', 'V', 'L', 'K', 'S', 'T', 'U', 'P'];

export async function loadFareFamilyCache(
  carrierIata: string,
  originIata: string,
  destIata: string,
  year?: number
): Promise<FareFamilyCache> {
  const policyYear = year ?? new Date().getFullYear();
  const cache: FareFamilyCache = new Map();

  const results = await Promise.all(
    ECONOMY_BOOKING_CLASSES.map(bc =>
      supabase.rpc('resolve_fare_family', {
        p_carrier_iata: carrierIata,
        p_booking_class: bc,
        p_origin_iata: originIata,
        p_dest_iata: destIata,
        p_policy_year: policyYear,
      })
    )
  );

  results.forEach((res, i) => {
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      cache.set(ECONOMY_BOOKING_CLASSES[i], res.data[0] as FareFamilyRow);
    }
  });

  if (cache.size === 0) {
    console.warn('[AeroSweep] FareFamilyCache empty — airline schema may not have seed data for this route. Penalties will default to 0.');
  } else {
    console.log(`[AeroSweep] FareFamilyCache loaded: ${cache.size} booking classes for ${carrierIata} ${originIata}-${destIata}`);
  }

  return cache;
}

export async function computeParityPenalty(
  originalFamilyId: string,
  candidateFamilyId: string,
  passengerAdults = 1,
  passengerChildren = 0
): Promise<number> {
  if (!originalFamilyId || !candidateFamilyId) {
    return 0;
  }

  const { data, error } = await supabase.rpc('compute_parity_penalty', {
    p_original_family_id: originalFamilyId,
    p_candidate_family_id: candidateFamilyId,
    p_passenger_adults: passengerAdults,
    p_passenger_children: passengerChildren,
  });

  if (error) {
    console.error(`[AeroSweep] compute_parity_penalty RPC failed: ${error.message}`);
    return 0;
  }

  return (data as number) ?? 0;
}

export async function bulkInsertSearchResults(
  rows: Array<Record<string, any>>
): Promise<boolean> {
  if (rows.length === 0) return true;

  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('search_results')
      .insert(batch);

    if (error) {
      console.error(`[AeroSweep] search_results batch insert failed: ${error.message}`);
      return false;
    }
  }

  return true;
}

export async function upsertPriceCalendar(
  rows: Array<Record<string, any>>
): Promise<boolean> {
  if (rows.length === 0) return true;

  const { error } = await supabase
    .from('price_calendar')
    .upsert(rows, {
      onConflict: 'job_id,outbound_date,nights',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error(`[AeroSweep] price_calendar upsert failed: ${error.message}`);
    return false;
  }

  return true;
}
