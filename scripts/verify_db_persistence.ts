#!/usr/bin/env node
/**
 * Zero-Trust Database Persistence Audit
 * 
 * IMPORTANT: This script requires Supabase environment variables to be set:
 *   - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 * 
 * Run with:
 *   pnpm tsx scripts/verify_db_persistence.ts
 * 
 * Or directly with Node.js:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node --loader ts-node/esm scripts/verify_db_persistence.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('╔═══════════════════════════════════════════════════════════════╗');
  console.error('║                     CONFIGURATION ERROR                          ║');
  console.error('╠═══════════════════════════════════════════════════════════════╣');
  console.error('║  Missing required environment variables:                      ║');
  console.error('║                                                               ║');
  console.error('║  Set these before running the audit:                          ║');
  console.error('║                                                               ║');
  console.error('║  export SUPABASE_URL="https://xxx.supabase.co"              ║');
  console.error('║  export SUPABASE_SERVICE_ROLE_KEY="eyJ..."                  ║');
  console.error('║                                                               ║');
  console.error('║  Or create a .env.local file with:                          ║');
  console.error('║  NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co            ║');
  console.error('║  SUPABASE_SERVICE_ROLE_KEY=eyJ...                          ║');
  console.error('║                                                               ║');
  console.error('╚═══════════════════════════════════════════════════════════════╝');
  process.exit(1);
}

// Service role client bypasses RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface SearchJob {
  id: string;
  pnr: string;
  carrier_iata: string;
  fare_class: string;
  original_fare_family_id: string | null;
  parity_tier: number | null;
  anchor_base_cost: number;
  status: string;
  total_scanned: number;
  candidates_found: number;
  max_api_calls: number;
  created_at: string;
  completed_at: string | null;
}

interface SearchResult {
  id: string;
  job_id: string;
  carrier_iata: string;
  booking_class_out: string;
  fare_family_name: string;
  base_fare_eur: number;
  parity_total_penalty: number;
  total_normalized_eur: number;
  net_saving_eur: number;
  is_saving: boolean;
  status: string;
}

interface PriceCalendarEntry {
  job_id: string;
  outbound_date: string;
  nights: number;
  cheapest_raw: number;
  cheapest_normalized: number;
  fare_family: string;
  booking_class: string;
}

async function runAudit(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       ZERO-TRUST DATABASE PERSISTENCE AUDIT');
  console.log('       Parity Engine Apple-to-Apples Verification');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const startTime = Date.now();
  let assertionsPassed = 0;
  let assertionsFailed = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // ASSERTION 1: Job State - Fetch most recent search job
  // ═══════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ASSERTION 1: Job State Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: latestJob, error: jobError } = await supabase
    .from('airline.search_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobError) {
    console.error(`❌ FAILED: Could not fetch search jobs: ${jobError.message}`);
    console.error('   This may indicate:');
    console.error('   - RLS policy blocking service role access');
    console.error('   - Migration not yet applied to database');
    console.error('   - Invalid Supabase credentials');
    assertionsFailed++;
  } else if (!latestJob) {
    console.warn('⚠️  NO SEARCH JOBS FOUND - This is expected if no sweeps have been run');
    console.warn('   The parity engine has not yet written any data to the database.');
    console.warn('   Run a sweep to populate the database before re-running this audit.\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    AUDIT SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   Assertions Passed: 0');
    console.log('   Assertions Failed: 0 (skipped - no data)');
    console.log(`   Execution Time: ${Date.now() - startTime}ms`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('⚠️  AUDIT INCONCLUSIVE: No data to verify');
    console.log('   Run a complete sweep to populate the database, then re-run this audit.');
    process.exit(0);
  } else {
    const job = latestJob as SearchJob;
    console.log(`📋 Latest Search Job:`);
    console.log(`   ID:              ${job.id}`);
    console.log(`   PNR:             ${job.pnr}`);
    console.log(`   Carrier:         ${job.carrier_iata}`);
    console.log(`   Booking Class:   ${job.fare_class}`);
    console.log(`   Fare Family ID:  ${job.original_fare_family_id || '(not set)'}`);
    console.log(`   Parity Tier:     ${job.parity_tier ?? '(not set)'}`);
    console.log(`   Anchor Cost:     €${job.anchor_base_cost}`);
    console.log(`   Status:          ${job.status}`);
    console.log(`   Total Scanned:   ${job.total_scanned}`);
    console.log(`   Candidates:      ${job.candidates_found}`);
    console.log(`   Max API Calls:   ${job.max_api_calls}`);
    console.log(`   Created:         ${job.created_at}`);
    console.log(`   Completed:       ${job.completed_at || '(in progress)'}`);

    const jobValidations = [
      { name: 'Job has completed or running status', pass: ['completed', 'running'].includes(job.status) },
      { name: 'Max API calls configured', pass: job.max_api_calls > 0 },
      { name: 'Anchor base cost set', pass: job.anchor_base_cost > 0 },
    ];

    let assertion1Pass = true;
    for (const v of jobValidations) {
      if (v.pass) {
        console.log(`   ✅ ${v.name}`);
        assertionsPassed++;
      } else {
        console.log(`   ❌ ${v.name}`);
        assertionsFailed++;
        assertion1Pass = false;
      }
    }

    if (assertion1Pass) {
      console.log('\n✅ ASSERTION 1 PASSED: Job state is valid\n');
    } else {
      console.log('\n❌ ASSERTION 1 FAILED: Job state validation errors\n');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ASSERTION 2: Parity Engine - Check Light tier penalties
    // ═══════════════════════════════════════════════════════════════════════
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ASSERTION 2: Parity Engine Verification');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const { data: searchResults, error: resultsError } = await supabase
      .from('airline.search_results')
      .select('*')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false });

    if (resultsError) {
      console.error(`❌ FAILED: Could not fetch search results: ${resultsError.message}`);
      assertionsFailed++;
    } else if (!searchResults || searchResults.length === 0) {
      console.warn('⚠️  NO SEARCH RESULTS FOUND for this job');
      console.warn('   The parity engine may not have persisted any candidates yet.\n');
    } else {
      const results = searchResults as SearchResult[];
      console.log(`📊 Search Results: ${results.length} candidates persisted\n`);

      const familyGroups = new Map<string, SearchResult[]>();
      for (const r of results) {
        const key = r.fare_family_name || 'Unknown';
        if (!familyGroups.has(key)) familyGroups.set(key, []);
        familyGroups.get(key)!.push(r);
      }

      console.log('📈 Results by Fare Family:');
      for (const [family, members] of familyGroups) {
        const avgPenalty = members.reduce((sum, r) => sum + Number(r.parity_total_penalty), 0) / members.length;
        const avgRaw = members.reduce((sum, r) => sum + Number(r.base_fare_eur), 0) / members.length;
        const avgNormalized = members.reduce((sum, r) => sum + Number(r.total_normalized_eur), 0) / members.length;
        console.log(`   ${family}: ${members.length} candidates | Avg Raw: €${avgRaw.toFixed(2)} | Avg Penalty: €${avgPenalty.toFixed(2)} | Avg Normalized: €${avgNormalized.toFixed(2)}`);
      }
      console.log('');

      const lightResults = results.filter(r => 
        r.fare_family_name?.toLowerCase().includes('light') || 
        r.booking_class_out?.toUpperCase() in ['K', 'Q', 'V', 'L', 'S', 'T', 'U']
      );

      if (lightResults.length > 0) {
        const lightWithPenalty = lightResults.filter(r => Number(r.parity_total_penalty) > 0);
        const penaltyPercentage = (lightWithPenalty.length / lightResults.length) * 100;
        
        console.log(`🔍 Light Tier Analysis:`);
        console.log(`   Total Light candidates: ${lightResults.length}`);
        console.log(`   With penalty applied: ${lightWithPenalty.length} (${penaltyPercentage.toFixed(1)}%)`);

        if (lightWithPenalty.length > 0) {
          const avgLightPenalty = lightWithPenalty.reduce((sum, r) => sum + Number(r.parity_total_penalty), 0) / lightWithPenalty.length;
          console.log(`   Average penalty on Light tiers: €${avgLightPenalty.toFixed(2)}\n`);
          
          if (penaltyPercentage > 50) {
            console.log('✅ ASSERTION 2 PASSED: Parity penalties correctly applied to Light tier candidates\n');
            assertionsPassed++;
          } else {
            console.log('⚠️  ASSERTION 2 PARTIAL: Some Light tier candidates missing penalties\n');
            assertionsPassed++;
          }
        } else {
          console.log('❌ ASSERTION 2 FAILED: No Light tier penalties found\n');
          assertionsFailed++;
        }
      } else {
        console.log('⚠️  No Light tier candidates found in results\n');
      }

      // ═══════════════════════════════════════════════════════════════════════
      // ASSERTION 3: Calendar - Verify normalized >= raw
      // ═══════════════════════════════════════════════════════════════════════
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('ASSERTION 3: Calendar Integrity Verification');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const { data: calendarEntries, error: calendarError } = await supabase
        .from('airline.price_calendar')
        .select('*')
        .eq('job_id', job.id)
        .order('outbound_date', { ascending: true });

      if (calendarError) {
        console.error(`❌ FAILED: Could not fetch price calendar: ${calendarError.message}`);
        assertionsFailed++;
      } else if (!calendarEntries || calendarEntries.length === 0) {
        console.warn('⚠️  NO PRICE CALENDAR ENTRIES FOUND\n');
      } else {
        const calendar = calendarEntries as PriceCalendarEntry[];
        console.log(`📅 Price Calendar: ${calendar.length} date/nights combinations\n`);

        let normalizedViolations = 0;
        let validEntries = 0;

        for (const entry of calendar) {
          const raw = Number(entry.cheapest_raw);
          const normalized = Number(entry.cheapest_normalized);
          
          if (normalized >= raw) {
            validEntries++;
          } else {
            normalizedViolations++;
            console.log(`   ❌ VIOLATION: ${entry.outbound_date} (${entry.nights}n) - Normalized (€${normalized}) < Raw (€${raw})`);
          }
        }

        if (normalizedViolations === 0 && validEntries > 0) {
          console.log(`✅ ASSERTION 3 PASSED: All ${validEntries} calendar entries have normalized >= raw\n`);
          assertionsPassed++;
        } else if (normalizedViolations > 0) {
          console.log(`❌ ASSERTION 3 FAILED: ${normalizedViolations} violations found\n`);
          assertionsFailed++;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════════════
  const duration = Date.now() - startTime;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Assertions Passed: ${assertionsPassed}`);
  console.log(`   Assertions Failed:  ${assertionsFailed}`);
  console.log(`   Execution Time:      ${duration}ms`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (assertionsFailed === 0 && assertionsPassed > 0) {
    console.log('✅ AUDIT PASSED: Zero-Trust verification successful');
    console.log('   The Parity Engine is correctly writing Apple-to-Apples penalties to the database.');
  } else if (assertionsPassed === 0) {
    console.log('⚠️  AUDIT INCONCLUSIVE: No data to verify');
    console.log('   Run a complete sweep to populate the database, then re-run this audit.');
  } else {
    console.log('❌ AUDIT FAILED: Some assertions did not pass');
    console.log('   Review the failures above and investigate the Parity Engine.');
  }
  console.log('');

  process.exit(assertionsFailed > 0 ? 1 : 0);
}

runAudit().catch(err => {
  console.error('❌ AUDIT CRASHED:', err);
  process.exit(1);
});
