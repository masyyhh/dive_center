-- Count and fingerprint only pre-existing application tables.
SET TIME ZONE 'UTC';
SELECT format(
  'SELECT %L, count(*), md5(coalesce(string_agg(md5(to_jsonb(row_data)::text), '''' ORDER BY md5(to_jsonb(row_data)::text) COLLATE "C"), '''')) FROM public.%I AS row_data',
  relname, relname
)
FROM pg_catalog.pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  AND relname NOT IN ('TankCommissionSettings', 'TankResource', 'TankCommissionRule', 'dive_trips', 'trip_crew_assignments', 'dive_trip_sites')
ORDER BY relname COLLATE "C"
\gexec
