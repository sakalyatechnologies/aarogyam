-- Automatic patient messages for the visit flow, fitted to the clinic's notification switches
-- (0616): no new settings column. The switches `welcome` (default on), `visit_summary` (on) and
-- `follow_up_booking` (off) live in `org_settings.notifications` beside `reminder_24h` and the
-- others and are read in code (aarogyam_domain::notification_prefs); a missing key means its
-- default, so nothing changes for a clinic until it chooses.
-- This migration adds the templates: welcome (with the estimated wait in minutes, worked out from
-- the queue), the visit summary link, its PIN as a separate message, and the follow-up booking
-- link, in English, Hindi and Marathi, for email (approved: the text is rendered from the row) and
-- WhatsApp (drafts until Meta approves each name). Variables are links, the PIN, minutes and a
-- date; never a patient's name or anything clinical.
set local lock_timeout = '5s';

alter function app.message_template_defaults() rename to message_template_defaults_v684;
create function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    select * from app.message_template_defaults_v684()
    union all
    select * from (values
      ('patient.welcome', 'email', 'en-IN',
       'Welcome to {{clinic_name}}! 🙏 Your estimated wait is about {{wait_minutes}} minutes. Get the patient app: {{app_link}} . Visit our website: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'email', 'hi-IN',
       '{{clinic_name}} में आपका स्वागत है! 🙏 आपका अनुमानित प्रतीक्षा समय लगभग {{wait_minutes}} मिनट है। पेशेंट ऐप: {{app_link}} । हमारी वेबसाइट: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'email', 'mr-IN',
       '{{clinic_name}} मध्ये आपले स्वागत आहे! 🙏 तुमचा अंदाजे प्रतीक्षा वेळ सुमारे {{wait_minutes}} मिनिटे आहे. पेशंट अ‍ॅप: {{app_link}} . आमची वेबसाइट: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'whatsapp', 'en-IN',
       'Welcome to {{clinic_name}}! 🙏 Your estimated wait is about {{wait_minutes}} minutes. Get the patient app: {{app_link}} . Visit our website: {{website_link}} 😊',
       'utility', 'aro_welcome_v1', 'draft'),
      ('patient.welcome', 'whatsapp', 'hi-IN',
       '{{clinic_name}} में आपका स्वागत है! 🙏 आपका अनुमानित प्रतीक्षा समय लगभग {{wait_minutes}} मिनट है। पेशेंट ऐप: {{app_link}} । हमारी वेबसाइट: {{website_link}} 😊',
       'utility', 'aro_welcome_v1', 'draft'),
      ('patient.welcome', 'whatsapp', 'mr-IN',
       '{{clinic_name}} मध्ये आपले स्वागत आहे! 🙏 तुमचा अंदाजे प्रतीक्षा वेळ सुमारे {{wait_minutes}} मिनिटे आहे. पेशंट अ‍ॅप: {{app_link}} . आमची वेबसाइट: {{website_link}} 😊',
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

    ) as v703 (key, channel, language, body, category, provider_template_ref, status)
  $$;
revoke execute on function app.message_template_defaults() from public;
revoke execute on function app.message_template_defaults_v684() from public;

-- Existing clinics get the new rows; their edits to older ones stay.
select app.seed_message_templates(o.id) from aarogyam.organizations o;
