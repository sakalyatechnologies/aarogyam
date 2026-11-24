-- The short note a doctor types on an X-ray pin ("decay here"), kept with the pin for the next visit.
-- Expand only: a nullable column; the table is already health data and erasure deletes the row.
set local lock_timeout = '5s';

alter table aarogyam.image_pins add column label text check (char_length(label) <= 80);
