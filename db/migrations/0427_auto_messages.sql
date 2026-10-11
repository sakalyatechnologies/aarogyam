-- Automatic patient messages for the visit flow (BE7, docs/plans/v9/be-msg.md): welcome after a
-- walk-in registers, the visit summary link with its PIN after a visit closes, and the booking
-- link for a follow-up. A clinic switches each on or off in `org_settings.auto_messages`;
-- welcome and the visit summary are on by default, the follow-up message is off.
set local lock_timeout = '5s';

alter table aarogyam.org_settings
  add column auto_messages jsonb not null
    default '{"welcome": true, "visit_summary": true, "follow_up_booking": false}'
    check (jsonb_typeof(auto_messages) = 'object');

-- The new templates, in English, Hindi and Marathi, for email (approved: the wording is
-- rendered from these rows) and WhatsApp (drafts until Meta approves each name). Never a
-- patient's name or anything clinical: only the variables in
-- aarogyam_domain::messaging::allowed_variables.
alter function app.message_template_defaults() rename to message_template_defaults_v8;
create function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    select * from app.message_template_defaults_v8()
    union all
    select * from (values
      ('patient.welcome', 'email', 'en-IN',
       'Welcome to {{clinic_name}}! 🙏 Thank you for choosing us. Get the patient app: {{app_link}} . Visit our website: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'email', 'hi-IN',
       '{{clinic_name}} में आपका स्वागत है! 🙏 हमें चुनने के लिए धन्यवाद। पेशेंट ऐप: {{app_link}} । हमारी वेबसाइट: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'email', 'mr-IN',
       '{{clinic_name}} मध्ये आपले स्वागत आहे! 🙏 आम्हाला निवडल्याबद्दल धन्यवाद. पेशंट अ‍ॅप: {{app_link}} . आमची वेबसाइट: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'whatsapp', 'en-IN',
       'Welcome to {{clinic_name}}! 🙏 Thank you for choosing us. Get the patient app: {{app_link}} . Visit our website: {{website_link}} 😊',
       'utility', 'aro_welcome_v1', 'draft'),
      ('patient.welcome', 'whatsapp', 'hi-IN',
       '{{clinic_name}} में आपका स्वागत है! 🙏 हमें चुनने के लिए धन्यवाद। पेशेंट ऐप: {{app_link}} । हमारी वेबसाइट: {{website_link}} 😊',
       'utility', 'aro_welcome_v1', 'draft'),
      ('patient.welcome', 'whatsapp', 'mr-IN',
       '{{clinic_name}} मध्ये आपले स्वागत आहे! 🙏 आम्हाला निवडल्याबद्दल धन्यवाद. पेशंट अ‍ॅप: {{app_link}} . आमची वेबसाइट: {{website_link}} 😊',
       'utility', 'aro_welcome_v1', 'draft'),
      ('visit.summary', 'email', 'en-IN',
       'Thank you for visiting {{clinic_name}}! 😊 See your visit summary here: {{share_link}} . The PIN to open it follows in a separate message.',
       'utility', null, 'approved'),
      ('visit.summary', 'email', 'hi-IN',
       '{{clinic_name}} आने के लिए धन्यवाद! 😊 अपनी विज़िट का सारांश यहाँ देखें: {{share_link}} । इसे खोलने का PIN अलग संदेश में आएगा।',
       'utility', null, 'approved'),
      ('visit.summary', 'email', 'mr-IN',
       '{{clinic_name}} ला भेट दिल्याबद्दल धन्यवाद! 😊 तुमच्या भेटीचा सारांश येथे पहा: {{share_link}} . तो उघडण्याचा PIN वेगळ्या संदेशात येईल.',
       'utility', null, 'approved'),
      ('visit.summary', 'whatsapp', 'en-IN',
       'Thank you for visiting {{clinic_name}}! 😊 See your visit summary here: {{share_link}} . The PIN to open it follows in a separate message.',
       'utility', 'aro_visit_summary_v1', 'draft'),
      ('visit.summary', 'whatsapp', 'hi-IN',
       '{{clinic_name}} आने के लिए धन्यवाद! 😊 अपनी विज़िट का सारांश यहाँ देखें: {{share_link}} । इसे खोलने का PIN अलग संदेश में आएगा।',
       'utility', 'aro_visit_summary_v1', 'draft'),
      ('visit.summary', 'whatsapp', 'mr-IN',
       '{{clinic_name}} ला भेट दिल्याबद्दल धन्यवाद! 😊 तुमच्या भेटीचा सारांश येथे पहा: {{share_link}} . तो उघडण्याचा PIN वेगळ्या संदेशात येईल.',
       'utility', 'aro_visit_summary_v1', 'draft'),
      ('visit.summary_pin', 'email', 'en-IN',
       '{{clinic_name}}: your PIN to open the visit summary is {{pin}} . Please do not share it. 🔒',
       'utility', null, 'approved'),
      ('visit.summary_pin', 'email', 'hi-IN',
       '{{clinic_name}}: विज़िट का सारांश खोलने का आपका PIN है {{pin}} । कृपया इसे किसी से साझा न करें। 🔒',
       'utility', null, 'approved'),
      ('visit.summary_pin', 'email', 'mr-IN',
       '{{clinic_name}}: भेटीचा सारांश उघडण्याचा तुमचा PIN आहे {{pin}} . कृपया तो कोणालाही सांगू नका. 🔒',
       'utility', null, 'approved'),
      ('visit.summary_pin', 'whatsapp', 'en-IN',
       '{{clinic_name}}: your PIN to open the visit summary is {{pin}} . Please do not share it. 🔒',
       'utility', 'aro_visit_pin_v1', 'draft'),
      ('visit.summary_pin', 'whatsapp', 'hi-IN',
       '{{clinic_name}}: विज़िट का सारांश खोलने का आपका PIN है {{pin}} । कृपया इसे किसी से साझा न करें। 🔒',
       'utility', 'aro_visit_pin_v1', 'draft'),
      ('visit.summary_pin', 'whatsapp', 'mr-IN',
       '{{clinic_name}}: भेटीचा सारांश उघडण्याचा तुमचा PIN आहे {{pin}} . कृपया तो कोणालाही सांगू नका. 🔒',
       'utility', 'aro_visit_pin_v1', 'draft'),
      ('visit.follow_up_booking', 'email', 'en-IN',
       '{{clinic_name}}: your follow-up visit is due on {{due_on}} . 🗓️ Book a time here: {{booking_link}} . See you soon! 😊',
       'utility', null, 'approved'),
      ('visit.follow_up_booking', 'email', 'hi-IN',
       '{{clinic_name}}: आपकी अगली फ़ॉलो-अप विज़िट {{due_on}} को है। 🗓️ समय यहाँ बुक करें: {{booking_link}} । मिलते हैं! 😊',
       'utility', null, 'approved'),
      ('visit.follow_up_booking', 'email', 'mr-IN',
       '{{clinic_name}}: तुमची पुढील तपासणी {{due_on}} रोजी आहे. 🗓️ वेळ येथे बुक करा: {{booking_link}} . लवकरच भेटू! 😊',
       'utility', null, 'approved'),
      ('visit.follow_up_booking', 'whatsapp', 'en-IN',
       '{{clinic_name}}: your follow-up visit is due on {{due_on}} . 🗓️ Book a time here: {{booking_link}} . See you soon! 😊',
       'utility', 'aro_follow_up_booking_v1', 'draft'),
      ('visit.follow_up_booking', 'whatsapp', 'hi-IN',
       '{{clinic_name}}: आपकी अगली फ़ॉलो-अप विज़िट {{due_on}} को है। 🗓️ समय यहाँ बुक करें: {{booking_link}} । मिलते हैं! 😊',
       'utility', 'aro_follow_up_booking_v1', 'draft'),
      ('visit.follow_up_booking', 'whatsapp', 'mr-IN',
       '{{clinic_name}}: तुमची पुढील तपासणी {{due_on}} रोजी आहे. 🗓️ वेळ येथे बुक करा: {{booking_link}} . लवकरच भेटू! 😊',
       'utility', 'aro_follow_up_booking_v1', 'draft')

    ) as v9 (key, channel, language, body, category, provider_template_ref, status)
  $$;
revoke execute on function app.message_template_defaults() from public;
revoke execute on function app.message_template_defaults_v8() from public;

-- Existing clinics get the new rows; their edits to older ones stay.
select app.seed_message_templates(o.id) from aarogyam.organizations o;
