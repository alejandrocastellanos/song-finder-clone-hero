-- CH Buscador: contador de descargas, lo más descargado y valoraciones.
-- Pégalo en Supabase > SQL Editor y pulsa Run. Se puede ejecutar más de una vez.
-- La web no toca las tablas: solo puede llamar a las funciones de abajo, que validan cada dato.

create table if not exists public.download_daily (
  day       date   not null default current_date,
  md5       text   not null check (md5 ~ '^[0-9a-f]{32}$'),
  artist    text   not null check (char_length(artist) between 1 and 120),
  name      text   not null check (char_length(name) between 1 and 160),
  downloads bigint not null default 0,
  primary key (day, md5)
);

create table if not exists public.ratings (
  md5        text     not null check (md5 ~ '^[0-9a-f]{32}$'),
  level      text     not null check (level in ('E', 'M', 'H')),
  voter      uuid     not null,   -- id al azar guardado en el navegador; no identifica a nadie
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (md5, level, voter)
);

-- con RLS activo y sin políticas, nadie lee ni escribe las tablas directamente
alter table public.download_daily enable row level security;
alter table public.ratings enable row level security;

create or replace function public.record_download(p_md5 text, p_artist text, p_name text)
returns void language sql security definer set search_path = '' as $$
  insert into public.download_daily (md5, artist, name, downloads)
  values (p_md5, left(trim(p_artist), 120), left(trim(p_name), 160), 1)
  on conflict (day, md5) do update set downloads = public.download_daily.downloads + 1;
$$;

create or replace function public.downloads_total()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(downloads), 0)::bigint from public.download_daily;
$$;

create or replace function public.top_downloads_week(p_limit int default 10)
returns table (md5 text, artist text, name text, downloads bigint)
language sql stable security definer set search_path = '' as $$
  select md5, max(artist), max(name), sum(downloads)::bigint
  from public.download_daily
  where day > current_date - 7
  group by md5
  order by 4 desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.rate_level(p_md5 text, p_level text, p_stars int, p_voter uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.ratings (md5, level, voter, stars)
  values (p_md5, p_level, p_voter, p_stars)
  on conflict (md5, level, voter) do update set stars = excluded.stars, updated_at = now();
$$;

create or replace function public.rating_summary(p_md5 text)
returns table (level text, average numeric, votes bigint)
language sql stable security definer set search_path = '' as $$
  select level, round(avg(stars), 1), count(*)
  from public.ratings where md5 = p_md5 group by level;
$$;

-- solo estas funciones quedan disponibles para la web
revoke all on function public.record_download(text, text, text) from public;
revoke all on function public.downloads_total() from public;
revoke all on function public.top_downloads_week(int) from public;
revoke all on function public.rate_level(text, text, int, uuid) from public;
revoke all on function public.rating_summary(text) from public;
grant execute on function public.record_download(text, text, text) to anon, authenticated;
grant execute on function public.downloads_total() to anon, authenticated;
grant execute on function public.top_downloads_week(int) to anon, authenticated;
grant execute on function public.rate_level(text, text, int, uuid) to anon, authenticated;
grant execute on function public.rating_summary(text) to anon, authenticated;
