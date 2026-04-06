#!/usr/bin/env tsx
/**
 * Duffel Reference Data Sync Script
 * 
 * Syncs the complete airline directory from Duffel's API to our
 * Supabase airline.carriers table for offline reference during sweeps.
 * 
 * Usage:
 *   pnpm sync:reference
 * 
 * Environment variables required:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - DUFFEL_ACCESS_TOKEN (or DUFFEL_API_KEY)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Duffel } from '@duffel/api';

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DUFFEL_ACCESS_TOKEN',
  'DUFFEL_API_KEY',
];

function validateEnvironment(): void {
  const missing: string[] = [];
  
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  
  if (missing.length > 0) {
    console.error('╔═══════════════════════════════════════════════════════════════╗');
    console.error('║                     FATAL ERROR                              ║');
    console.error('╠═══════════════════════════════════════════════════════════════╣');
    console.error('║  Missing required environment variables:                      ║');
    missing.forEach(v => console.error(`║    - ${v}`));
    console.error('║                                                               ║');
    console.error('║  Set these before running:                                   ║');
    console.error('║    export NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"  ║');
    console.error('║    export SUPABASE_SERVICE_ROLE_KEY="eyJ..."                 ║');
    console.error('║    export DUFFEL_ACCESS_TOKEN="duffel_live_xxx"             ║');
    console.error('╚═══════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }
}

interface DuffelAirline {
  id: string;
  name: string;
  iata_code: string | null;
  logo_lockup_url?: string | null;
  logo_symbol_url?: string | null;
  conditions_of_carriage_url?: string | null;
}

interface CarrierRow {
  iata_code: string;
  name: string;
  logo_lockup_url: string | null;
  logo_symbol_url: string | null;
  conditions_url: string | null;
  duffel_id: string;
  updated_at: string;
}

function isValidIATACode(code: string | null): code is string {
  if (!code) return false;
  return /^[A-Z]{2}$/.test(code);
}

async function fetchDuffelAirlines(duffelClient: Duffel): Promise<DuffelAirline[]> {
  console.log('📡 Fetching airlines from Duffel API (handling pagination)...');
  
  const airlines: DuffelAirline[] = [];
  let afterCursor: string | undefined = undefined;
  let hasMorePages = true;
  let pageCount = 0;
  
  try {
    while (hasMorePages) {
      pageCount++;
      const params = afterCursor ? { after: afterCursor } : {};
      
      const response = await duffelClient.airlines.list(params as any);
      const data = response.data;
      
      console.log(`  Page ${pageCount}: fetched ${data.length} airlines`);
      
      for (const airline of data) {
        airlines.push({
          id: airline.id,
          name: airline.name,
          iata_code: airline.iata_code || null,
          logo_lockup_url: airline.logo_lockup_url,
          logo_symbol_url: airline.logo_symbol_url,
          conditions_of_carriage_url: airline.conditions_of_carriage_url,
        });
      }
      
      const meta = response.meta;
      if (meta?.after && meta.after !== afterCursor) {
        afterCursor = meta.after;
      } else {
        hasMorePages = false;
      }
    }
    
    console.log(`✅ Retrieved ${airlines.length} airlines from Duffel (${pageCount} pages)`);
    return airlines;
  } catch (error) {
    console.error('❌ Failed to fetch airlines from Duffel:', error);
    process.exit(1);
  }
}

async function upsertCarriers(
  supabase: SupabaseClient,
  carriers: CarrierRow[]
): Promise<{ inserted: number; updated: number; errors: number }> {
  console.log(`\n📦 Upserting ${carriers.length} carriers to airline.carriers...`);
  
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < carriers.length; i += BATCH_SIZE) {
    const batch = carriers.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(carriers.length / BATCH_SIZE);
    
    console.log(`  Processing batch ${batchNum}/${totalBatches} (${batch.length} carriers)...`);
    
    try {
      // EXACT SUPABASE QUERY SYNTAX for cross-schema upsert:
      // We use supabase.schema('airline').from('carriers').upsert(...)
      // This explicitly targets the airline schema
      
      const { data, error } = await (supabase as any)
        .schema('airline')
        .from('carriers')
        .upsert(batch, {
          onConflict: 'iata_code',
          ignoreDuplicates: false,
        });
      
      if (error) {
        // If schema() method fails, fall back to raw SQL via RPC
        console.warn(`  ⚠️  Schema method failed, trying RPC fallback: ${error.message}`);
        
        const values = batch.map((c, idx) => {
          const offset = idx * 7;
          return `($${offset + 1}::varchar, $${offset + 2}::varchar, $${offset + 3}::varchar, $${offset + 4}::varchar, $${offset + 5}::varchar, $${offset + 6}::varchar, $${offset + 7}::timestamptz)`;
        }).join(', ');
        
        const params: any[] = [];
        batch.forEach(c => {
      params.push(
        c.iata_code,
        c.name,
        c.logo_lockup_url,
        c.logo_symbol_url,
        c.conditions_url,
        c.duffel_id,
        c.updated_at
      );
        });
        
        const rpcResult = await supabase.rpc('execute_sql', {
          query: `INSERT INTO airline.carriers (iata_code, name, logo_lockup_url, logo_symbol_url, conditions_url, duffel_id, updated_at) VALUES ${values} ON CONFLICT (iata_code) DO UPDATE SET name = EXCLUDED.name, logo_lockup_url = EXCLUDED.logo_lockup_url, logo_symbol_url = EXCLUDED.logo_symbol_url, conditions_url = EXCLUDED.conditions_url, duffel_id = EXCLUDED.duffel_id, updated_at = EXCLUDED.updated_at`,
        });
        
        if (rpcResult.error) {
          throw new Error(rpcResult.error.message);
        }
      }
      
      // Count results
      const existing = await supabase
        .from('carriers')
        .select('iata_code', { count: 'exact', head: true })
        .in('iata_code', batch.map(c => c.iata_code));
      
      const existingCount = existing.count || 0;
      inserted += batch.length - existingCount;
      updated += existingCount;
      
    } catch (err) {
      console.error(`  ❌ Batch ${batchNum} failed:`, err);
      errors += batch.length;
    }
  }
  
  return { inserted, updated, errors };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       DUFFEL REFERENCE DATA SYNC');
  console.log('       Airline Directory → airline.carriers');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('[1/4] Validating environment...');
  validateEnvironment();
  console.log('✅ All required environment variables present\n');
  
  console.log('[2/4] Initializing clients...');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const duffelToken = process.env.DUFFEL_ACCESS_TOKEN || process.env.DUFFEL_API_KEY!;
  
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  const duffel = new Duffel({ token: duffelToken });
  
  console.log('✅ Supabase client initialized (service role)');
  console.log('✅ Duffel client initialized\n');
  
  console.log('[3/4] Fetching airlines from Duffel...');
  const duffelAirlines = await fetchDuffelAirlines(duffel);
  
  console.log('\n[4/4] Processing and filtering airlines...');
  
  const now = new Date().toISOString();
  const carriers: CarrierRow[] = [];
  let skippedNoIATA = 0;
  let skippedInvalidIATA = 0;
  
  for (const airline of duffelAirlines) {
    if (!airline.iata_code) {
      skippedNoIATA++;
      continue;
    }
    
    if (!isValidIATACode(airline.iata_code)) {
      skippedInvalidIATA++;
      continue;
    }
    
    carriers.push({
      iata_code: airline.iata_code,
      name: airline.name,
      logo_lockup_url: airline.logo_lockup_url || null,
      logo_symbol_url: airline.logo_symbol_url || null,
      conditions_url: airline.conditions_of_carriage_url || null,
      duffel_id: airline.id,
      updated_at: now,
    });
  }
  
  console.log(`\n📊 Filtering Results:`);
  console.log(`   Total fetched:    ${duffelAirlines.length}`);
  console.log(`   Valid (2-letter): ${carriers.length}`);
  console.log(`   Skipped (no IATA): ${skippedNoIATA}`);
  console.log(`   Skipped (invalid): ${skippedInvalidIATA}`);
  
  if (carriers.length === 0) {
    console.error('\n❌ FATAL: No valid airlines to sync. Aborting.');
    process.exit(1);
  }
  
  console.log('\n📦 Upserting to database...');
  const result = await upsertCarriers(supabase, carriers);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   Carriers synced:  ${result.inserted + result.updated}`);
  console.log(`   Inserted:         ${result.inserted}`);
  console.log(`   Updated:          ${result.updated}`);
  console.log(`   Errors:           ${result.errors}`);
  console.log(`   Total valid:      ${carriers.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (result.errors > 0) {
    console.warn(`⚠️  ${result.errors} carriers failed to sync. Check Supabase logs.`);
  } else {
    console.log('✅ All carriers synced successfully!');
  }
}

main().catch((error) => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});
