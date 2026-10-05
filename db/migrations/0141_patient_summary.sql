-- A patient list's summaries as a function, so each list query returns its patients and
-- their summaries in one statement instead of two.
set local lock_timeout = '5s';

-- What a patient list shows beside each patient: the next booked appointment, the balance on
-- issued bills, what they have paid, and whether a recall is due by `p_today`. Runs as the
-- caller, so row-level security limits it to the current clinic. Lists join it laterally, so
-- the patients and their summaries come back in one statement.
create function app.patient_summary(p_patient_id uuid, p_now timestamptz, p_today date)
  returns table (next_starts_at timestamptz, next_practitioner text, balance_paise bigint,
                 lifetime_paid_paise bigint, recall_due boolean)
  language sql stable
  as $$
    select nx.starts_at,
           nx.display_name,
           (coalesce((select sum(i.total_paise) from aarogyam.invoices i
                      where i.patient_id = p_patient_id and i.status = 'issued'), 0)
            - coalesce((select sum(a.amount_paise)
                        from aarogyam.invoices i
                        join aarogyam.payment_allocations a
                          on a.org_id = i.org_id and a.invoice_id = i.id and a.patient_id = i.patient_id
                        join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
                        where i.patient_id = p_patient_id and i.status = 'issued'
                          and m.status = 'received'), 0))::bigint,
           coalesce((select sum(m.amount_paise) from aarogyam.payments m
                     where m.patient_id = p_patient_id and m.status = 'received'), 0)::bigint,
           exists (select 1 from aarogyam.recalls r
                   where r.patient_id = p_patient_id and r.status in ('due', 'notified')
                     and r.due_on <= p_today)
    from (select 1) one
    left join lateral (
      select a.starts_at, pr.display_name
      from aarogyam.appointments a
      join aarogyam.practitioners pr on pr.org_id = a.org_id and pr.id = a.practitioner_id
      where a.patient_id = p_patient_id and a.deleted_at is null
        and a.status in ('booked', 'confirmed') and a.starts_at >= p_now
      order by a.starts_at
      limit 1
    ) nx on true
  $$;
grant execute on function app.patient_summary(uuid, timestamptz, date) to app_user;
