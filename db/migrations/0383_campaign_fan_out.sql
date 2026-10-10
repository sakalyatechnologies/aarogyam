-- Campaigns (see 0380, 0381): expanding a due campaign into `messages`, 500 patients at a time.
-- One call takes the campaign that has waited longest (skip locked, so workers share them), reads
-- the audience's next patients after the stored cursor, queues one promotional message each
-- under `campaign:<id>:<patient>`, and moves the cursor, all in one transaction: a crash loses
-- nothing and a repeat queues nothing twice (the dedupe key). Consent, opt-outs and quiet hours
-- are not checked here: app.message_dispatch reports them when each message is due.
--
-- Two caps apply when the message is queued, from org_settings.notifications:
--   promo_per_patient_per_week (default 2): a patient with that many promotional messages queued
--     or sent in the last 7 days gets a message skipped as `frequency_cap`, so the count shows it.
--   promo_daily_cap (default 200): promotional messages scheduled per clinic per UTC day;
--     the rest are scheduled for the next days with room, not dropped.
set local lock_timeout = '5s';

create function app.campaigns_fan_out_next(p_batch int)
  returns table (org_id uuid, campaign_id uuid, queued int, capped int, finished boolean)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    c aarogyam.campaigns;
    v_filter jsonb;
    v_key text;
    v_notes jsonb;
    v_week int;
    v_daily int;
    v_ids uuid[];
    v_id uuid;
    v_day timestamptz;
    v_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
    v_room int;
    v_queued int := 0;
    v_capped int := 0;
    v_rows int;
    v_limit int := least(greatest(coalesce(p_batch, 500), 1), 1000);
  begin
    select k.* into c from aarogyam.campaigns k
    join aarogyam.organizations o on o.id = k.org_id and o.status in ('trial', 'active')
    where k.status in ('scheduled', 'sending') and k.scheduled_at <= now()
    order by coalesce(k.last_batch_at, '-infinity'), k.scheduled_at, k.id
    limit 1 for update of k skip locked;
    if not found then
      return;
    end if;
    select a.filter into v_filter from aarogyam.audiences a
      where a.org_id = c.org_id and a.id = c.audience_id;
    select t.key into v_key from aarogyam.message_templates t
      where t.org_id = c.org_id and t.id = c.template_id;
    select coalesce(s.notifications, '{}') into v_notes from aarogyam.org_settings s
      where s.org_id = c.org_id;
    v_notes := coalesce(v_notes, '{}');
    v_week := case when v_notes->>'promo_per_patient_per_week' ~ '^[0-9]{1,4}$'
                   then (v_notes->>'promo_per_patient_per_week')::int else 2 end;
    v_daily := greatest(case when v_notes->>'promo_daily_cap' ~ '^[0-9]{1,6}$'
                             then (v_notes->>'promo_daily_cap')::int else 200 end, 1);

    select coalesce(array_agg(x.id order by x.id), '{}') into v_ids from (
      select a.id from app.audience_patients(c.org_id, v_filter) a
      where c.fan_out_cursor is null or a.id > c.fan_out_cursor
      order by a.id limit v_limit) x;

    v_day := v_today;
    select greatest(v_daily - count(*), 0) into v_room from aarogyam.messages m
      where m.org_id = c.org_id and m.purpose = 'promotional' and m.status <> 'skipped'
        and m.scheduled_for >= v_day and m.scheduled_for < v_day + interval '1 day';
    foreach v_id in array v_ids loop
      if (select count(*) from aarogyam.messages m
          where m.org_id = c.org_id and m.patient_id = v_id and m.purpose = 'promotional'
            and m.status in ('queued', 'sending', 'sent')
            and m.created_at > now() - interval '7 days') >= v_week then
        insert into aarogyam.messages (org_id, patient_id, channel, kind, purpose, template_key,
                                       variables, campaign_id, dedupe_key, status, skip_reason,
                                       processed_at)
        values (c.org_id, v_id, c.channel, 'clinic.message', 'promotional', v_key, '{}',
                c.id, 'campaign:' || c.id || ':' || v_id, 'skipped', 'frequency_cap', now())
        on conflict (org_id, dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_capped := v_capped + v_rows;
        continue;
      end if;
      -- Skip to the next day with room when today's cap is spent (only for new messages).
      if not exists (select 1 from aarogyam.messages m
                     where m.org_id = c.org_id and m.dedupe_key = 'campaign:' || c.id || ':' || v_id) then
        while v_room <= 0 loop
          v_day := v_day + interval '1 day';
          select greatest(v_daily - count(*), 0) into v_room from aarogyam.messages m
            where m.org_id = c.org_id and m.purpose = 'promotional' and m.status <> 'skipped'
              and m.scheduled_for >= v_day and m.scheduled_for < v_day + interval '1 day';
        end loop;
        insert into aarogyam.messages (org_id, patient_id, channel, kind, purpose, template_key,
                                       variables, body, campaign_id, dedupe_key, scheduled_for)
        values (c.org_id, v_id, c.channel, 'clinic.message', 'promotional', v_key,
                jsonb_build_object('subject', c.name, 'offer_text', c.offer_text),
                case when c.channel = 'email' then c.offer_text end, c.id,
                'campaign:' || c.id || ':' || v_id,
                case when v_day = v_today then greatest(now(), c.scheduled_at) else v_day end)
        on conflict (org_id, dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_queued := v_queued + v_rows;
        v_room := v_room - v_rows;
      end if;
    end loop;

    update aarogyam.campaigns k
      set status = case when cardinality(v_ids) < v_limit then 'sent' else 'sending' end,
          fan_out_cursor = coalesce(v_ids[cardinality(v_ids)], k.fan_out_cursor),
          fan_out_started_at = coalesce(k.fan_out_started_at, now()),
          fan_out_done_at = case when cardinality(v_ids) < v_limit then now() end,
          last_batch_at = now()
      where k.org_id = c.org_id and k.id = c.id;
    return query select c.org_id, c.id, v_queued, v_capped, cardinality(v_ids) < v_limit;
  end
  $$;
revoke execute on function app.campaigns_fan_out_next(int) from public;
grant execute on function app.campaigns_fan_out_next(int) to aarogyam_api;
