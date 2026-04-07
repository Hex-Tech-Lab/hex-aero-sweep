# Hex-Aero-Sweep Technical Documentation

## Architecture Overview

Hex-Aero-Sweep is a Next.js application for aviation pricing intelligence, enabling users to upload airline tickets (PDF) and discover optimal rebooking opportunities using UCB1-based exploration algorithms.

## Database Schema

### Dual-Schema Supabase Architecture

The application uses two schemas:

1. **public** - Core sweep execution tracking
   - `tickets` - Parsed ticket data
   - `sweep_executions` - Sweep execution records
   - `flight_candidates` - Candidate flight results
   - `audit_logs` - Execution audit trail

2. **airline** - Airline intelligence layer
   - `fare_families` - Fare family definitions per carrier/booking class
   - `search_jobs` - Sweep job records with fare family context
   - `search_results` - Persisted sweep results
   - `price_calendar` - Cheapest normalized prices per date/nights

## RPC Functions

### airline.resolve_fare_family()

Resolves a booking class to fare family metadata:

```sql
airline.resolve_fare_family(
  p_carrier_iata varchar,
  p_booking_class char(1),
  p_origin_iata varchar,
  p_dest_iata varchar,
  p_policy_year integer DEFAULT 2026
) RETURNS TABLE (
  fare_family_id uuid,
  fare_family_name varchar,
  parity_tier integer,
  change_pre_fee_eur numeric,
  change_post_fee_eur numeric,
  cancel_fee_eur numeric,
  refund_full boolean,
  checked_pieces integer
)
```

### airline.compute_parity_penalty()

Computes EUR penalty to normalize a candidate against anchor tier:

```sql
airline.compute_parity_penalty(
  p_original_family_id uuid,
  p_candidate_family_id uuid,
  p_passenger_adults integer DEFAULT 1,
  p_passenger_children integer DEFAULT 0
) RETURNS numeric
```

## State Management

### Zustand Stores

- **useTicketStore** - Ticket data, configuration, sweep state
- **useTelemetryStore** - Telemetry and logging

### Fare Family Cache

The application loads fare family data once at sweep start using `loadFareFamilyCache()`. This performs 12 parallel RPC calls (one per booking class) to avoid N+1 query issues during candidate processing.

## UCB1 Sweep Algorithm

The sweep execution follows a multi-phase approach:

1. **PROBE** - Strategic sampling across timeline (~15% of budget)
2. **EXPLOIT** - Focus on top candidates + surrounding dates (70% of remaining)
3. **SCATTER** - Random sampling of unexplored weeks
4. **FINALIZE** - Deep search on top matches

## TECH DEBT — ACTIVE

| Issue | Location | Status | Fix |
|---|---|---|---|
| `url.parse()` DEP0169 | `@duffel/api` SDK internals | 🟡 MONITOR — vendor issue, not our code | Track SDK releases for fix |
| `url.parse()` DEP0169 | `pdf-parse@1.1.4` internals | 🟡 PHASE 2 — migrate to `pdfjs-dist` | BB task, MVP Phase 2 |
| `Buffer()` deprecation | `pdf-parse@1.1.4` internals | 🟡 PHASE 2 — same migration | BB task, MVP Phase 2 |
| Hardcoded €150 penalty | ~~`lib/duffel-service.ts`~~ | ✅ RESOLVED | Migrated to `compute_parity_penalty()` RPC |

## Environment Variables

Required:
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`
- `DUFFEL_API_KEY`
- `OPENROUTER_API_KEY`
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`

## Last Verified
- Phase 1: Verified by KiloCode 2026-04-07

