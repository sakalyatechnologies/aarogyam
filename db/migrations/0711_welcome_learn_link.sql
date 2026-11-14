-- Welcome messages carry a link to the clinic's public care-tips pages (`/learn`) as the new
-- variable `learn_link`. A new defaults version replaces the six `patient.welcome` rows (email and
-- WhatsApp, English, Hindi, Marathi); every other default is unchanged. WhatsApp keeps its draft
-- status under a new name (`aro_welcome_v2`), since Meta approves a name with its exact text.
-- New clinics are seeded from the defaults; an existing clinic's welcome row moves to the new text
-- only while its body still equals the old default exactly, so a clinic's own edits are kept.
-- The care-tips pages are placeholder copy for now; the variable is only a link.
set local lock_timeout = '5s';

alter function app.message_template_defaults() rename to message_template_defaults_v707;
create function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    select * from app.message_template_defaults_v707() d where d.key <> 'patient.welcome'
    union all
    select * from (values
      ('patient.welcome', 'email', 'en-IN',
       'Welcome to {{clinic_name}}! 🙏 Your estimated wait is about {{wait_minutes}} minutes. Get the patient app: {{app_link}} . Care tips: {{learn_link}} . Visit our website: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'email', 'hi-IN',
       '{{clinic_name}} में आपका स्वागत है! 🙏 आपका अनुमानित प्रतीक्षा समय लगभग {{wait_minutes}} मिनट है। पेशेंट ऐप: {{app_link}} । देखभाल के सुझाव: {{learn_link}} । हमारी वेबसाइट: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'email', 'mr-IN',
       '{{clinic_name}} मध्ये आपले स्वागत आहे! 🙏 तुमचा अंदाजे प्रतीक्षा वेळ सुमारे {{wait_minutes}} मिनिटे आहे. पेशंट अ‍ॅप: {{app_link}} . काळजीच्या सूचना: {{learn_link}} . आमची वेबसाइट: {{website_link}} 😊',
       'utility', null, 'approved'),
      ('patient.welcome', 'whatsapp', 'en-IN',
       'Welcome to {{clinic_name}}! 🙏 Your estimated wait is about {{wait_minutes}} minutes. Get the patient app: {{app_link}} . Care tips: {{learn_link}} . Visit our website: {{website_link}} 😊',
       'utility', 'aro_welcome_v2', 'draft'),
      ('patient.welcome', 'whatsapp', 'hi-IN',
       '{{clinic_name}} में आपका स्वागत है! 🙏 आपका अनुमानित प्रतीक्षा समय लगभग {{wait_minutes}} मिनट है। पेशेंट ऐप: {{app_link}} । देखभाल के सुझाव: {{learn_link}} । हमारी वेबसाइट: {{website_link}} 😊',
       'utility', 'aro_welcome_v2', 'draft'),
      ('patient.welcome', 'whatsapp', 'mr-IN',
       '{{clinic_name}} मध्ये आपले स्वागत आहे! 🙏 तुमचा अंदाजे प्रतीक्षा वेळ सुमारे {{wait_minutes}} मिनिटे आहे. पेशंट अ‍ॅप: {{app_link}} . काळजीच्या सूचना: {{learn_link}} . आमची वेबसाइट: {{website_link}} 😊',
       'utility', 'aro_welcome_v2', 'draft')
    ) as v711 (key, channel, language, body, category, provider_template_ref, status)
  $$;
revoke execute on function app.message_template_defaults() from public;
revoke execute on function app.message_template_defaults_v707() from public;

-- Existing clinics: only an untouched welcome row (body equal to the old default) is replaced.
update aarogyam.message_templates t
   set body = n.body,
       provider_template_ref = n.provider_template_ref,
       status = n.status,
       updated_at = now()
  from app.message_template_defaults_v707() o
  join app.message_template_defaults() n
    on n.key = o.key and n.channel = o.channel and n.language = o.language
 where o.key = 'patient.welcome'
   and t.key = o.key and t.channel = o.channel and t.language = o.language
   and t.body = o.body
   and t.provider_template_ref is not distinct from o.provider_template_ref
   and t.status = o.status;

select app.seed_message_templates(o.id) from aarogyam.organizations o;
