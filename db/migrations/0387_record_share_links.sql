-- Links to a patient's records: a clinic picks which kinds the patient may see (the current
-- chart, X-rays, issued bills) and how long the link works (1 hour, 24 hours or 7 days). The
-- same share_links table, the same token and PIN, resource 'records'. The existing links to
-- prescriptions are unchanged. Every open and every X-ray download is written to the access
-- record. Nothing new has a patient_id, so audit.erasure_steps already covers it.
set local lock_timeout = '5s';

alter table aarogyam.share_links drop constraint share_links_resource_check;
alter table aarogyam.share_links
  add constraint share_links_resource_check
    check (resource in ('prescription', 'invoice', 'report', 'upload_request', 'records')),
  add column record_types text[]
    check (record_types <@ array['chart', 'xrays', 'bills']::text[]
           and cardinality(record_types) between 1 and 3),
  add constraint share_links_records check ((resource = 'records') = (record_types is not null));
