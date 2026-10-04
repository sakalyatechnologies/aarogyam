-- Clinic settings edited by the clinic itself: its names, GSTIN and time zone on the
-- organisation row. Branding, billing and prescription settings live in org_settings and the
-- default branch's address and phone in branches, which members could already update.
--
-- Members may update only these columns, only of their own clinic. The slug, number prefix,
-- specialty and status stay with the console. The API also checks settings.manage.
set local lock_timeout = '5s';

grant update (name, legal_name, gstin, timezone) on aarogyam.organizations to app_user;
create policy own_clinic_update on aarogyam.organizations for update to app_user
  using (id = (select app.tenant_id()))
  with check (id = (select app.tenant_id()));
