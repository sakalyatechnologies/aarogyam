-- A queued follow-up booking message is skipped when the patient booked or the recall was
-- closed before it went out (BE7 gap).
alter table aarogyam.messages drop constraint messages_skip_reason_check;
alter table aarogyam.messages add constraint messages_skip_reason_check check (skip_reason in (
  'no_consent', 'consent_withdrawn', 'opted_out', 'no_address', 'patient_erased',
  'patient_merged', 'patient_deleted', 'patient_deceased', 'appointment_changed',
  'unsupported', 'channel_disabled', 'no_opt_in', 'template_unavailable', 'template_paused',
  'marketing_limit', 'undeliverable', 'frequency_cap', 'campaign_cancelled',
  'follow_up_resolved'));
