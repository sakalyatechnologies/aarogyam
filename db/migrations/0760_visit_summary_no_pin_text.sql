-- Visit summary links open without a PIN (decisions.md, 25 Nov 2026), so the default visit
-- summary text no longer says a PIN follows. A new defaults version replaces the six
-- `visit.summary` rows; every other default is unchanged. WhatsApp keeps its draft status under a
-- new name (`aro_visit_summary_v2`), since Meta approves a name with its exact text. The
-- `visit.summary_pin` rows stay (old queued messages still render). An existing clinic's row moves
-- to the new text only while its body still equals the old default exactly.
set local lock_timeout = '5s';

alter function app.message_template_defaults() rename to message_template_defaults_v711;
create function app.message_template_defaults()
  returns table (key text, channel text, language text, body text, category text,
                 provider_template_ref text, status text)
  language sql immutable set search_path = ''
  as $$
    select * from app.message_template_defaults_v711() d where d.key <> 'visit.summary'
    union all
    select * from (values
      ('visit.summary', 'email', 'en-IN',
       'Thank you for visiting {{clinic_name}}! 😊 See your visit summary here: {{share_link}} 🙏',
       'utility', null, 'approved'),
      ('visit.summary', 'email', 'hi-IN',
       '{{clinic_name}} आने के लिए धन्यवाद! 😊 अपनी विज़िट का सारांश यहाँ देखें: {{share_link}} 🙏',
       'utility', null, 'approved'),
      ('visit.summary', 'email', 'mr-IN',
       '{{clinic_name}} ला भेट दिल्याबद्दल धन्यवाद! 😊 तुमच्या भेटीचा सारांश येथे पहा: {{share_link}} 🙏',
       'utility', null, 'approved'),
      ('visit.summary', 'whatsapp', 'en-IN',
       'Thank you for visiting {{clinic_name}}! 😊 See your visit summary here: {{share_link}} 🙏',
       'utility', 'aro_visit_summary_v2', 'draft'),
      ('visit.summary', 'whatsapp', 'hi-IN',
       '{{clinic_name}} आने के लिए धन्यवाद! 😊 अपनी विज़िट का सारांश यहाँ देखें: {{share_link}} 🙏',
       'utility', 'aro_visit_summary_v2', 'draft'),
      ('visit.summary', 'whatsapp', 'mr-IN',
       '{{clinic_name}} ला भेट दिल्याबद्दल धन्यवाद! 😊 तुमच्या भेटीचा सारांश येथे पहा: {{share_link}} 🙏',
       'utility', 'aro_visit_summary_v2', 'draft')
    ) as v760 (key, channel, language, body, category, provider_template_ref, status)
  $$;
revoke execute on function app.message_template_defaults() from public;
revoke execute on function app.message_template_defaults_v711() from public;

update aarogyam.message_templates t
   set body = n.body,
       provider_template_ref = n.provider_template_ref,
       status = n.status,
       updated_at = now()
  from app.message_template_defaults_v711() o
  join app.message_template_defaults() n
    on n.key = o.key and n.channel = o.channel and n.language = o.language
 where o.key = 'visit.summary'
   and t.key = o.key and t.channel = o.channel and t.language = o.language
   and t.body = o.body
   and t.provider_template_ref is not distinct from o.provider_template_ref
   and t.status = o.status;

select app.seed_message_templates(o.id) from aarogyam.organizations o;
