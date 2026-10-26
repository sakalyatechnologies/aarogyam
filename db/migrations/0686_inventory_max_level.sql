-- An item's top-up level: what to order up to. Null means none is set. The reorder level says
-- when an item is low; the max level says how much to have after reordering (the suggested
-- order is max_level less what is on hand). It can never be below the reorder level.
set local lock_timeout = '5s';

alter table aarogyam.inventory_items
  add column max_level bigint check (max_level is null or max_level >= 0),
  add constraint inventory_items_max_above_reorder
    check (max_level is null or max_level >= reorder_level);
