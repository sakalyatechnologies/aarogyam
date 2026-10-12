-- Stock alerts, the database side (plan section 5). The job reads one snapshot of what each
-- item's use and shelf look like, works out the projection in Rust (domain::inventory::project),
-- and writes the alert through app.record_stock_alert.
--   * app.stock_usage_snapshot(p_now, p_limit): across clinics in use whose `low_stock`
--     switch is on, one row per active, non-deleted item with alerts_enabled: the clinic's local
--     today, the batches still unexpired today (expiry and quantity, parallel arrays; the Rust
--     side drops those that expire before the projected run-out), the units use on each of the
--     last 28 clinic-local days (kind `use` only: receipts, expiries and adjustments are not use),
--     the first day of use inside that window, the reorder level and the lead time.
--   * app.record_stock_alert: one alert per item and local day (a second call the same day does
--     nothing); an alert for a later day marks the item's older open alerts handled. Refuses an
--     item that is not in the clinic.
--   * app.clear_stock_alerts: the item recovered; every open alert for it is handled.
-- All three run as the owner (the job has no clinic session), so each states its clinic.
set local lock_timeout = '5s';

create function app.stock_usage_snapshot(p_now timestamptz, p_limit int)
  returns table (
    org_id uuid,
    item_id uuid,
    local_today date,
    reorder_level bigint,
    lead_time_days smallint,
    on_hand bigint,
    batch_expiries date[],
    batch_quantities bigint[],
    use_days date[],
    use_quantities bigint[],
    first_use_on date
  )
  language sql stable security definer set search_path = ''
  as $$
    select i.org_id, i.id, d.today, i.reorder_level, i.lead_time_days,
           coalesce(b.on_hand, 0), coalesce(b.expiries, '{}'), coalesce(b.quantities, '{}'),
           coalesce(u.days, '{}'), coalesce(u.quantities, '{}'), u.first_use_on
    from aarogyam.inventory_items i
    join aarogyam.organizations o on o.id = i.org_id and o.status in ('trial', 'active')
    left join aarogyam.org_settings s on s.org_id = i.org_id
    cross join lateral (select app.clinic_local_date(p_now, o.timezone) as today) d
    left join lateral (
      select sum(sb.quantity) as on_hand,
             array_agg(sb.expiry order by sb.expiry nulls last, sb.id) as expiries,
             array_agg(sb.quantity order by sb.expiry nulls last, sb.id) as quantities
      from aarogyam.stock_batches sb
      where sb.org_id = i.org_id and sb.item_id = i.id and sb.quantity > 0
        and (sb.expiry is null or sb.expiry >= d.today)
    ) b on true
    left join lateral (
      select array_agg(x.day order by x.day) as days,
             array_agg(x.used order by x.day) as quantities,
             min(x.day) as first_use_on
      from (select app.clinic_local_date(m.created_at, o.timezone) as day, -sum(m.quantity) as used
            from aarogyam.stock_movements m
            where m.org_id = i.org_id and m.item_id = i.id and m.kind = 'use'
              and m.created_at >= p_now - interval '30 days'
            group by 1) x
      where x.day > d.today - 28 and x.day <= d.today
    ) u on true
    where i.active and i.deleted_at is null and i.alerts_enabled
      and app.notification_switch(s.notifications, 'low_stock', true)
    order by i.org_id, i.id
    limit least(greatest(coalesce(p_limit, 500), 1), 5000)
  $$;
revoke execute on function app.stock_usage_snapshot(timestamptz, int) from public;
grant execute on function app.stock_usage_snapshot(timestamptz, int) to aarogyam_api;

-- Writes the stock alert for an item on a local day. Returns true when it wrote one, false when
-- the item already has an alert for that day. Raises no_data_found for an item of another clinic.
create function app.record_stock_alert(p_org uuid, p_item uuid, p_alert_on date, p_on_hand numeric,
                                       p_days_cover numeric, p_reason text)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_made int;
  begin
    perform 1 from aarogyam.inventory_items i where i.org_id = p_org and i.id = p_item;
    if not found then
      raise exception 'stock item not found' using errcode = 'P0002';
    end if;
    insert into aarogyam.staff_notifications
      (org_id, kind, inventory_item_id, alert_on, stock_on_hand, stock_days_cover, stock_reason, href)
    values (p_org, 'stock_alert', p_item, p_alert_on, p_on_hand, p_days_cover, p_reason, '/stock')
    on conflict (org_id, inventory_item_id, alert_on) where kind = 'stock_alert' do nothing;
    get diagnostics v_made = row_count;
    update aarogyam.staff_notifications n set handled_at = now()
    where n.org_id = p_org and n.inventory_item_id = p_item and n.kind = 'stock_alert'
      and n.alert_on < p_alert_on and n.handled_at is null;
    return v_made = 1;
  end
  $$;
revoke execute on function app.record_stock_alert(uuid, uuid, date, numeric, numeric, text) from public;
grant execute on function app.record_stock_alert(uuid, uuid, date, numeric, numeric, text) to aarogyam_api;

-- The item is no longer low or running out: handles its open alerts. Returns how many.
create function app.clear_stock_alerts(p_org uuid, p_item uuid)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with cleared as (
      update aarogyam.staff_notifications n set handled_at = now()
      where n.org_id = p_org and n.inventory_item_id = p_item and n.kind = 'stock_alert'
        and n.handled_at is null
      returning 1
    )
    select count(*)::int from cleared
  $$;
revoke execute on function app.clear_stock_alerts(uuid, uuid) from public;
grant execute on function app.clear_stock_alerts(uuid, uuid) to aarogyam_api;
