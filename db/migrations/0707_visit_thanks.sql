-- The thank-you when a payment settles a visit's bill (`visit.thanks`), fitted to the clinic's
-- notification switches like 0703's messages: the switch `thanks` (default on) lives in
-- `org_settings.notifications` and is read in code, so no column is added. This migration adds
-- the templates in English, Hindi and Marathi, for email (approved) and WhatsApp (drafts until
-- Meta approves the name). The only variables are the clinic's name and its booking link; never
-- a patient's name, an amount or anything clinical.
set local lock_timeout = '5s';

alter function app.message_template_defaults() rename to message_template_defaults_v703;
create function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    select * from app.message_template_defaults_v703()
    union all
    select * from (values
      ('visit.thanks', 'email', 'en-IN',
       'Thank you for visiting {{clinic_name}}! 🙏 We hope to see you again. Book your next visit or share your feedback here: {{booking_link}} 😊',
       'utility', null, 'approved'),
      ('visit.thanks', 'email', 'hi-IN',
       '{{clinic_name}} आने के लिए धन्यवाद! 🙏 आपसे फिर मिलने की आशा है। अगली विज़िट बुक करें या अपनी राय दें: {{booking_link}} 😊',
       'utility', null, 'approved'),
      ('visit.thanks', 'email', 'mr-IN',
       '{{clinic_name}} ला भेट दिल्याबद्दल धन्यवाद! 🙏 पुन्हा भेटूया. पुढील भेट बुक करा किंवा तुमचा अभिप्राय द्या: {{booking_link}} 😊',
       'utility', null, 'approved'),
      ('visit.thanks', 'whatsapp', 'en-IN',
       'Thank you for visiting {{clinic_name}}! 🙏 We hope to see you again. Book your next visit or share your feedback here: {{booking_link}} 😊',
       'utility', 'aro_visit_thanks_v1', 'draft'),
      ('visit.thanks', 'whatsapp', 'hi-IN',
       '{{clinic_name}} आने के लिए धन्यवाद! 🙏 आपसे फिर मिलने की आशा है। अगली विज़िट बुक करें या अपनी राय दें: {{booking_link}} 😊',
       'utility', 'aro_visit_thanks_v1', 'draft'),
      ('visit.thanks', 'whatsapp', 'mr-IN',
       '{{clinic_name}} ला भेट दिल्याबद्दल धन्यवाद! 🙏 पुन्हा भेटूया. पुढील भेट बुक करा किंवा तुमचा अभिप्राय द्या: {{booking_link}} 😊',
       'utility', 'aro_visit_thanks_v1', 'draft')
    ) as v707 (key, channel, language, body, category, provider_template_ref, status)
  $$;
revoke execute on function app.message_template_defaults() from public;
revoke execute on function app.message_template_defaults_v703() from public;

-- Existing clinics get the new rows; their edits to older ones stay.
select app.seed_message_templates(o.id) from aarogyam.organizations o;
