-- Local development data: two fictional clinics with synthetic patients. Never real people.
-- Runs as the owner (scripts/dev-db.sh --seed) after migrations; safe to run once per database.
-- Fixed IDs so the dev sign-in can mint tokens for these people (auth_uid = token `sub`).
--
--   Sunrise Dental     sunrise.localtest.me   owner Asha, doctor Dev, front desk Farah
--   Lotus Dental Care  lotus.localtest.me     owner Bina; Dev also consults here
--   Console            Sakalya Admin (platform owner)
\set ON_ERROR_STOP 1
begin;

insert into aarogyam.users (id, auth_uid, display_name, email, phone_e164) values
  ('01920000-0000-7000-8000-0000000000a1', 'a1a1a1a1-0000-4000-8000-000000000001', 'Asha Kulkarni', 'asha@sunrise.example', '+919800000001'),
  ('01920000-0000-7000-8000-0000000000a2', 'a1a1a1a1-0000-4000-8000-000000000002', 'Dr Dev Rao', 'dev@sunrise.example', '+919800000002'),
  ('01920000-0000-7000-8000-0000000000a3', 'a1a1a1a1-0000-4000-8000-000000000003', 'Farah Shaikh', 'farah@sunrise.example', '+919800000003'),
  ('01920000-0000-7000-8000-0000000000b1', 'b1b1b1b1-0000-4000-8000-000000000001', 'Bina Joshi', 'bina@lotus.example', '+919800000011');

-- Sakalya staff for the console.
insert into aarogyam.users (id, auth_uid, display_name, email) values
  ('01920000-0000-7000-8000-0000000000c1', 'c1c1c1c1-0000-4000-8000-000000000001', 'Sakalya Admin', 'admin@sakalya.example');
insert into aarogyam.platform_users (user_id, role) values ('01920000-0000-7000-8000-0000000000c1', 'owner');

select app.create_clinic('sunrise', 'Sunrise Dental', 'SD', 'dental', 'sunrise.localtest.me',
                         '01920000-0000-7000-8000-0000000000a1') as sunrise \gset
select app.create_clinic('lotus', 'Lotus Dental Care', 'LD', 'dental', 'lotus.localtest.me',
                         '01920000-0000-7000-8000-0000000000b1') as lotus \gset

insert into aarogyam.memberships (org_id, user_id, role_id, status, joined_at)
select :'sunrise', u.id, r.id, 'active', now()
from (values ('01920000-0000-7000-8000-0000000000a2'::uuid, 'doctor'),
             ('01920000-0000-7000-8000-0000000000a3'::uuid, 'front_desk')) as u(id, role_key)
join aarogyam.roles r on r.org_id = :'sunrise' and r.key = u.role_key;

insert into aarogyam.memberships (org_id, user_id, role_id, status, joined_at)
select :'lotus', '01920000-0000-7000-8000-0000000000a2', r.id, 'active', now()
from aarogyam.roles r where r.org_id = :'lotus' and r.key = 'consultant';

-- Patients, numbered the way the API numbers them.
select set_config('app.tenant_id', :'sunrise', true) \gset
insert into aarogyam.patients (number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, preferred_language)
select 'SD-' || app.next_number('patient'), p.name, p.sex, p.dob, p.estimated, p.phone, p.lang
from (values
  ('Priya Sharma', 'female', date '1990-04-12', false, '+919810000001', 'en-IN'),
  ('Rahul Verma', 'male', date '1985-11-03', false, '+919810000002', 'hi-IN'),
  ('Sneha Patil', 'female', date '1996-01-25', false, '+919810000003', 'mr-IN'),
  ('Arjun Nair', 'male', date '1978-07-19', false, '+919810000004', 'en-IN'),
  ('Kavya Iyer', 'female', date '2012-09-30', false, '+919810000005', 'en-IN'),
  ('Rohan Deshmukh', 'male', date '1970-01-01', true, '+919810000006', 'mr-IN'),
  ('Meera Pillai', 'female', date '1988-03-08', false, '+919810000007', 'en-IN'),
  ('Vikram Singh', 'male', date '1965-12-14', false, '+919810000008', 'hi-IN'),
  ('Ananya Gupta', 'female', date '2001-06-21', false, '+919810000009', 'hi-IN'),
  ('Siddharth Joshi', 'male', date '1993-10-10', false, '+919810000002', 'en-IN'),
  ('Pooja Kulkarni', 'female', date '1999-02-17', false, null, 'mr-IN'),
  ('Imran Khan', 'male', date '1982-05-29', false, '+919810000012', 'hi-IN')
) as p(name, sex, dob, estimated, phone, lang);

select set_config('app.tenant_id', :'lotus', true) \gset
insert into aarogyam.patients (number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, preferred_language)
select 'LD-' || app.next_number('patient'), p.name, p.sex, p.dob, false, p.phone, 'en-IN'
from (values
  ('Priya Sharma', 'female', date '1975-08-02', '+919820000001'),
  ('Nikhil Bhosale', 'male', date '1991-04-04', '+919820000002'),
  ('Divya Menon', 'female', date '1987-12-12', '+919820000003'),
  ('Aditya Kapoor', 'male', date '2005-03-15', '+919820000004'),
  ('Lakshmi Rao', 'female', date '1958-09-09', '+919820000005')
) as p(name, sex, dob, phone);

commit;
