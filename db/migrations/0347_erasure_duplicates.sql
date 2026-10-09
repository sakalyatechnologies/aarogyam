-- Possible-duplicate flags (0331) name two patients; erasing either one removes the flag.
-- Registered here rather than in 0331 because the erasure registry arrives in 0345.
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.patient_duplicates', 35, 'delete', null, 'patient_id = $2 or candidate_id = $2',
   'possible-duplicate flags');
