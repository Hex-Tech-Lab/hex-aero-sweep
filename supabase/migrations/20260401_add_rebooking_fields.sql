/*
  # Hex-Aero-Sweep Migration: Add Rebooking Mode Fields

  ## Purpose
  Adds support for rebooking mode configuration and enhanced search preferences
  to the search_logs table for full telemetry of sweep executions.

  ## New Columns

  ### `search_logs`
  - `rebooking_mode` (boolean) - Whether original departure was in the past
  - `direct_flight_only` (boolean) - Filter for direct flights only
  - `outbound_time_preference` (text) - Preferred outbound time: any, morning, afternoon, evening
  - `inbound_time_preference` (text) - Preferred return time: any, morning, afternoon, evening

  ## Migration Safety
  - Uses ALTER TABLE ADD COLUMN IF NOT EXISTS for idempotency
  - Safe to re-run
*/

-- Add rebooking mode flag
ALTER TABLE search_logs 
ADD COLUMN IF NOT EXISTS rebooking_mode boolean DEFAULT false;

-- Add flight preference filters
ALTER TABLE search_logs 
ADD COLUMN IF NOT EXISTS direct_flight_only boolean DEFAULT false;

ALTER TABLE search_logs 
ADD COLUMN IF NOT EXISTS outbound_time_preference text DEFAULT 'any';

ALTER TABLE search_logs 
ADD COLUMN IF NOT EXISTS inbound_time_preference text DEFAULT 'any';

-- Add index for rebooking mode queries
CREATE INDEX IF NOT EXISTS idx_search_logs_rebooking_mode 
ON search_logs(rebooking_mode) 
WHERE rebooking_mode = true;

-- Add index for time preference filtering
CREATE INDEX IF NOT EXISTS idx_search_logs_time_preferences 
ON search_logs(outbound_time_preference, inbound_time_preference);

-- Add comment for documentation
COMMENT ON COLUMN search_logs.rebooking_mode IS 'Whether original ticket departure was in the past, triggering rebooking mode';
COMMENT ON COLUMN search_logs.direct_flight_only IS 'Whether to filter for direct flights only';
COMMENT ON COLUMN search_logs.outbound_time_preference IS 'Preferred outbound departure time: any, morning, afternoon, evening';
COMMENT ON COLUMN search_logs.inbound_time_preference IS 'Preferred return departure time: any, morning, afternoon, evening';
