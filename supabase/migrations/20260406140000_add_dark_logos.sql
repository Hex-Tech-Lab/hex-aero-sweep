-- Migration: Add dark mode logo variants for Duffel carriers
-- Adds logo_lockup_dark_url and logo_symbol_dark_url columns

ALTER TABLE airline.carriers
  ADD COLUMN IF NOT EXISTS logo_lockup_dark_url text,
  ADD COLUMN IF NOT EXISTS logo_symbol_dark_url text;
