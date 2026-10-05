-- Forward-only production migration for the weather-aware observation fields.
-- Run after the existing runtime migrations. It is safe to run repeatedly.
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS weather_condition text DEFAULT 'UNKNOWN';
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS weather_severity text DEFAULT 'UNKNOWN';
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS precipitation_mm numeric;
ALTER TABLE fare_observations ADD COLUMN IF NOT EXISTS temperature_c numeric;
