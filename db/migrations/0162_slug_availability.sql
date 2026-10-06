-- Which of some candidate clinic slugs are taken, for the console's approve form, which checks
-- the address as it is typed and suggests free ones (`<name>-<city>`, or a short suffix). The
-- unique constraint on organizations.slug still has the final say.
set local lock_timeout = '5s';

create function app.console_slugs_taken(p_slugs text[])
  returns setof text
  language sql stable security definer set search_path = ''
  as $$
    select o.slug from aarogyam.organizations o
    where o.slug = any (p_slugs[1:20])
  $$;

grant execute on function app.console_slugs_taken(text[]) to aarogyam_api;
