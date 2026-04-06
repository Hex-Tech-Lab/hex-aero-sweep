-- Migration: Expand airline.carriers for rich Duffel reference data
-- Adds duffel_id, logo URLs, conditions URL, and updated_at columns

ALTER TABLE airline.carriers
  ADD COLUMN IF NOT EXISTS duffel_id text,
  ADD COLUMN IF NOT EXISTS logo_lockup_url text,
  ADD COLUMN IF NOT EXISTS logo_symbol_url text,
  ADD COLUMN IF NOT EXISTS conditions_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
