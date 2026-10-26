-- The `reminder.missed_visit` message: a note to a patient who missed an appointment, from the
-- front desk's Missed list. Template variables only (clinic name, booking link): no appointment
-- time, doctor or clinical detail. Sent as a reminder, so it needs reminders consent. Clinics
-- keep their own copies of the defaults (0375), so the new rows are seeded into each. Expand only.
set local lock_timeout = '5s';

create or replace function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    values
      ('care.note', 'email', 'en-IN', '{{subject}}', 'utility', null, 'approved'),
      ('reminder.follow_up', 'email', 'en-IN',
       '{{clinic_name}}: your follow-up visit is due {{due_on}}. Book at {{booking_link}}.',
       'utility', null, 'approved'),
      ('promo.offer', 'email', 'en-IN', '{{subject}}', 'marketing', null, 'approved'),
      ('appointment.reminder', 'email', 'en-IN',
       '{{clinic_name}}: a reminder of your appointment on {{appointment_time}} with {{doctor_name}}.',
       'utility', null, 'approved'),
      ('booking.requested', 'email', 'en-IN',
       '{{clinic_name}} received your request for {{when}} with {{doctor_name}}.', 'utility', null, 'approved'),
      ('booking.confirmed', 'email', 'en-IN',
       '{{clinic_name}} confirmed your appointment on {{when}} with {{doctor_name}}.', 'utility', null, 'approved'),
      ('booking.declined', 'email', 'en-IN',
       '{{clinic_name}} could not take your request for {{when}}.', 'utility', null, 'approved'),
      ('prescription.shared', 'email', 'en-IN',
       '{{doctor_name}} at {{clinic_name}} shared your prescription, open until {{expires_on}}.',
       'utility', null, 'approved'),
      ('patient_app.invited', 'email', 'en-IN',
       '{{clinic_name}} invited you to the patient app, until {{expires_on}}.', 'utility', null, 'approved'),
      ('care.note', 'whatsapp', 'en-IN',
       'Message from {{clinic_name}}: {{subject}}. Please call the clinic with any questions.',
       'utility', 'aro_care_note_v1', 'draft'),
      ('reminder.follow_up', 'whatsapp', 'en-IN',
       '{{clinic_name}}: your follow-up visit is due. Book a time at {{booking_link}} or call the clinic.',
       'utility', 'aro_follow_up_v1', 'draft'),
      ('promo.offer', 'whatsapp', 'en-IN',
       '{{clinic_name}}: {{subject}}. Reply STOP to stop these messages.',
       'marketing', 'aro_offer_v1', 'draft'),
      ('appointment.reminder', 'whatsapp', 'en-IN',
       '{{clinic_name}}: a reminder of your appointment on {{appointment_time}} with {{doctor_name}}. Reply STOP to stop reminders.',
       'utility', 'aro_appointment_reminder_v1', 'draft'),
      ('reminder.missed_visit', 'email', 'en-IN',
       '{{clinic_name}}: we missed you at your appointment. Book a new time at {{booking_link}} or call the clinic.',
       'utility', null, 'approved'),
      ('reminder.missed_visit', 'whatsapp', 'en-IN',
       '{{clinic_name}}: we missed you at your appointment. Book a new time at {{booking_link}} or call the clinic.',
       'utility', 'aro_missed_visit_v1', 'draft')
  $$;

select app.seed_message_templates(o.id) from aarogyam.organizations o;
