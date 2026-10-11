-- Stock alerts, the schema (docs/decisions.md, "Staff operations"; plan section 1, "Stock").
--   * inventory_items.lead_time_days: days from ordering to delivery (default 7, 0 to 120); the
--     projection alerts when the stock covers no more than lead time plus three days.
--   * inventory_items.alerts_enabled: an item can opt out of stock alerts (default on).
--   * stock_movements.task_occurrence_id: which to-do a use came from, when it came from one.
--     Same clinic only: a composite foreign key. Most movements have none, hence the partial index.
--   * staff_notifications.inventory_item_id gets its composite foreign key (0660 left it for the
--     table it points at, which has existed since 0061).
-- Expand only: new columns with defaults or nulls; existing rows and readers are unchanged.
-- inventory_items and stock_movements are audited by default (protect_clinic_table), and neither
-- new column holds anything to leave out or mask, so audit.audit_config needs no row.
set local lock_timeout = '5s';

alter table aarogyam.inventory_items
  add column lead_time_days smallint not null default 7
    check (lead_time_days between 0 and 120),
  add column alerts_enabled boolean not null default true;

alter table aarogyam.stock_movements
  add column task_occurrence_id uuid,
  add constraint stock_movements_task_occurrence_fk
    foreign key (org_id, task_occurrence_id) references aarogyam.task_occurrences (org_id, id)
    not valid;
alter table aarogyam.stock_movements validate constraint stock_movements_task_occurrence_fk;
create index stock_movements_task_occurrence
  on aarogyam.stock_movements (org_id, task_occurrence_id) where task_occurrence_id is not null;

alter table aarogyam.staff_notifications
  add constraint staff_notifications_inventory_item_fk
    foreign key (org_id, inventory_item_id) references aarogyam.inventory_items (org_id, id)
    not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_inventory_item_fk;
