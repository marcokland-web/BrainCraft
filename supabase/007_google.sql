-- =====================================================================
-- BrainCraft 007: Eltern mit Google, Kinder-Geräte gekoppelt – statt Familien-Code (additiv)
-- Stand 04.11.2026 (Entscheidungen von Marco 03.11. und 04.11.: Familien-Code und Einladungscode fallen weg;
-- auf Kinder-Geräten keine Google-Sitzung, sie werden vom Eltern-Gerät gekoppelt).
-- Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. Setzt 001, 003-006 voraus (002 ruht weiterhin).
-- NOCH NICHT EINGESPIELT. Datei ohne begin/commit: in EINER Transaktion einspielen
-- (SQL-Editor mit begin/commit drumherum oder CLI-Lauf), vorher Probelauf mit Rücknahme.
--
-- Vorher in Supabase: Authentication → Providers → Google einschalten; Redirect-URLs
-- https://marcokland-web.github.io/BrainCraft/ und http://localhost:5173/BrainCraft/ eintragen.
--
--  * Neue Tabelle braincraft.family_parents (family_id, user_id): welche Google-Konten (auth.users)
--    Eltern einer Familie sind. Ein Konto gehört zu höchstens einer Familie (unique user_id),
--    höchstens 4 Eltern je Familie. Löschen der Familie oder des Kontos löscht die Zuordnung.
--  * Neue Tabelle braincraft.parent_invites (family_id, email): Einladung weiterer Eltern per
--    Gmail-Adresse. Wer sich mit dieser BESTÄTIGTEN Adresse anmeldet und noch keine Familie hat,
--    sieht die Einladung (bc_my_invites) und nimmt sie sichtbar an (bc_invite_accept) oder lehnt ab
--    (bc_invite_decline) – nie still. 14 Tage gültig, höchstens 5 offene je Familie.
--  * Adressen werden einheitlich verglichen (braincraft.email_norm, gleiche Regel wie src/lib/email.ts):
--    klein, ohne Leer- und unsichtbare Zeichen; bei gmail.com/googlemail.com ohne Punkte und +Zusatz,
--    googlemail.com → gmail.com.
--  * families.code_hash darf leer sein (neue Familien haben keinen Code mehr). Spalte, Tabelle
--    invites und alle Funktionen mit p_code entfernt erst 008 (nach der Auslieferung).
--  * Kinder-Geräte: braincraft.devices (Geräte-Token nur als SHA-256), gekoppelt über einen Einmal-Code
--    aus braincraft.pair_codes (10 Zeichen ohne verwechselbare Zeichen, 10 Minuten, einmal einlösbar),
--    Fehlversuche gebremst über braincraft.pair_attempts (5 je IP und 15 min, 50 insgesamt je 15 min).
--    Das Kinder-Gerät schickt sein Token im Header x-bc-device (nicht als Parameter: keine neuen
--    Signaturen, Token nicht im Anfrage-Körper; CORS erlaubt den Header, geprüft 04.11.2026).
--    Altgeräte tauschen ihren Familien-Code einmalig gegen ein Geräte-Token (bc_device_from_code,
--    nur bis 008, gleiche Bremse).
--  * Neue Helfer braincraft.my_family() / my_parent(p_token): Familie über das Geräte-Token
--    (Header x-bc-device) oder sonst über auth.uid() (Eltern-Gerät mit Google).
--    braincraft.my_google_family() / my_google_parent(p_token): nur Google-Konto (Eltern verwalten,
--    Geräte koppeln und entfernen). Fehlercodes: not_signed_in, no_family, device_revoked, device_unknown.
--  * Alle bisherigen bc_*-Funktionen mit p_code gibt es zusätzlich OHNE p_code (gleiche Namen,
--    gleiche Logik, Familie über auth.uid()); bc_pull liefert zusätzlich family_id.
--    Eltern-Rechte weiterhin nur mit Eltern-Token aus bc_parent_unlock(p_pin) (bcrypt-PIN,
--    Sperre nach 3 Fehlversuchen) – die Google-Sitzung auf dem Kinder-iPad allein reicht nie.
--  * Neue Funktionen: bc_session(), bc_my_invites(), bc_invite_accept(p_family_id),
--    bc_invite_decline(p_family_id), bc_family_create(p_child_name, p_pin), bc_parents(p_token),
--    bc_parent_invite(p_token, p_email), bc_parent_invite_delete(p_token, p_email),
--    bc_parent_remove(p_token, p_user_id).
--  * Rechte: Kinder- und PIN-Funktionen ohne p_code für anon (Kinder-Gerät mit Token) und authenticated;
--    Konto-Funktionen (Eltern, Einladungen, Geräte, Familie anlegen) nur für authenticated.
--    Die alten p_code-Funktionen behalten ihre Rechte bis 008, damit die ausgelieferte App
--    bis zum Update weiterläuft.
--  * Bestandsfamilie: Die (einzige) vorhandene Familie wird Marcos Konto zugeordnet
--    (auth.users-ID unten, keine E-Mail-Adresse im Code). Profile, Fortschritt, Sterne,
--    Antworten, Belohnungen bleiben unverändert (es wird nur eine Zeile in family_parents angelegt).
--    Bei mehr als einer Familie bricht die Migration ab (Marco entscheidet).
-- Schema-Muster wie bisher (Rechenstern): RLS an, KEINE Policies, keine Tabellenrechte für
-- anon/authenticated; Zugriff nur über SECURITY-DEFINER-Funktionen, die auth.uid() prüfen.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING; auch nach 008 wiederholbar.
-- Achtung: Der Before-User-Created-Hook (live) liest braincraft.parent_invites (email, expires_at) und
-- braincraft.email_norm – diese Namen nicht ändern.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

-- Nur solange die Spalte existiert (nach 008 gibt es sie nicht mehr; 007 bleibt wiederholbar)
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'braincraft' and table_name = 'families' and column_name = 'code_hash') then
    alter table braincraft.families alter column code_hash drop not null;
  end if;
end $$;

create table if not exists braincraft.family_parents (
  family_id uuid not null references braincraft.families(id) on delete cascade,
  user_id   uuid not null unique references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists braincraft.parent_invites (
  family_id  uuid not null references braincraft.families(id) on delete cascade,
  email      text not null check (length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  primary key (family_id, email)
);
create index if not exists parent_invites_email_idx on braincraft.parent_invites (email);

-- Gekoppelte Kinder-Geräte (Token nur als SHA-256; das Token selbst liegt nur auf dem Gerät)
create table if not exists braincraft.devices (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references braincraft.families(id) on delete cascade,
  name         text not null default 'Kinder-Gerät' check (length(name) between 1 and 40),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  -- true = aus einem früheren Familien-Code getauscht (Altgerät; Bremse 5 je Familie und Tag)
  via_code     boolean not null default false
);
create index if not exists devices_family_idx on braincraft.devices (family_id);
alter table braincraft.devices add column if not exists via_code boolean not null default false;

-- Einmal-Codes zum Koppeln (nur Hash, 10 Minuten, einmal)
create table if not exists braincraft.pair_codes (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  family_id  uuid not null references braincraft.families(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name       text not null check (length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists pair_codes_family_idx on braincraft.pair_codes (family_id);

-- Einlöse-Versuche (Bremse gegen Raten); Einträge älter als 1 Tag löschen die Funktionen selbst
create table if not exists braincraft.pair_attempts (
  id  bigserial primary key,
  ip  text not null default '' check (length(ip) <= 64),
  ok  boolean not null,
  at  timestamptz not null default now()
);
create index if not exists pair_attempts_at_idx on braincraft.pair_attempts (at);

alter table braincraft.family_parents enable row level security;
alter table braincraft.parent_invites enable row level security;
alter table braincraft.devices        enable row level security;
alter table braincraft.pair_codes     enable row level security;
alter table braincraft.pair_attempts  enable row level security;

-- ---------------------------------------------------------------------
-- Interne Helfer
-- ---------------------------------------------------------------------

-- Adresse vergleichbar machen, gleiche Regel wie normEmail in src/lib/email.ts (Zeichenliste dort gleich):
-- Leer- und unsichtbare Zeichen weg (als chr(), keine literalen unsichtbaren Zeichen in dieser Datei),
-- nur A–Z klein schreiben (ASCII, in JS gleich), bei gmail.com/googlemail.com ohne Punkte und +Zusatz,
-- googlemail.com → gmail.com. Höchstens 320 Zeichen.
create or replace function braincraft.email_norm(p_email text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_class text := '[' || chr(9) || '-' || chr(13) || chr(32) || chr(133) || chr(160) || chr(173) || chr(5760)
                  || chr(6158) || chr(8192) || '-' || chr(8207) || chr(8232) || '-' || chr(8239) || chr(8287)
                  || chr(8288) || '-' || chr(8292) || chr(12288) || chr(65279) || ']';
  v text := translate(regexp_replace(left(coalesce(p_email, ''), 320), v_class, '', 'g'),
                      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  v_local text; v_domain text;
begin
  if position('@' in v) = 0 then return v; end if;
  v_local := split_part(v, '@', 1);
  v_domain := substr(v, position('@' in v) + 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(split_part(v_local, '+', 1), '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end $$;

-- Angemeldetes Konto (auth.uid() aus dem JWT der Anfrage), sonst not_signed_in
create or replace function braincraft.me()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return u;
end $$;

-- Geräte-Token aus dem Header x-bc-device (Kinder-Gerät), sonst null
create or replace function braincraft.device_token()
returns text language sql stable set search_path = '' as $$
  select nullif(left(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-bc-device', ''), 128), '');
$$;

-- Gerät zum Token im Header (auch widerrufen), sonst null
create or replace function braincraft.my_device()
returns braincraft.devices language sql stable security definer set search_path = '' as $$
  select d.* from braincraft.devices d
   where braincraft.device_token() ~ '^[0-9a-f]{64}$'
     and d.token_hash = encode(extensions.digest(braincraft.device_token(), 'sha256'), 'hex');
$$;

-- Familie des Google-Kontos, sonst no_family (Konto-Funktionen: nie über ein Geräte-Token)
create or replace function braincraft.my_google_family()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare f uuid;
begin
  select family_id into f from braincraft.family_parents where user_id = braincraft.me();
  if f is null then raise exception 'no_family'; end if;
  return f;
end $$;

-- Familie dieses Geräts: gekoppeltes Kinder-Gerät (Header x-bc-device) oder Eltern-Gerät mit Google
create or replace function braincraft.my_family()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare d braincraft.devices;
begin
  if braincraft.device_token() is not null then
    d := braincraft.my_device();
    if d.id is null then raise exception 'device_unknown'; end if;
    if d.revoked_at is not null then raise exception 'device_revoked'; end if;
    return d.family_id;
  end if;
  return braincraft.my_google_family();
end $$;

-- Familie dieses Geräts MIT gültigem Eltern-Token (PIN), sonst pin_required
create or replace function braincraft.my_parent(p_token text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.my_family();
begin
  if not braincraft.is_parent(f, p_token) then raise exception 'pin_required'; end if;
  return f;
end $$;

-- Google-Konto MIT Eltern-Token (Eltern verwalten, Geräte koppeln/entfernen)
create or replace function braincraft.my_google_parent(p_token text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_family();
begin
  if not braincraft.is_parent(f, p_token) then raise exception 'pin_required'; end if;
  return f;
end $$;

-- IP der Anfrage (erster Eintrag von x-forwarded-for) für die Bremse beim Koppeln
-- Zuerst cf-connecting-ip (von Cloudflare gesetzt, nicht fälschbar); sonst der LETZTE Eintrag von
-- x-forwarded-for (den hängt der eigene Proxy an, die vorderen kann der Absender selbst schreiben; Siggi M1)
create or replace function braincraft.request_ip()
returns text language sql stable set search_path = '' as $$
  with h as (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as j)
  select left(coalesce(
           nullif(btrim(j->>'cf-connecting-ip'), ''),
           btrim(reverse(split_part(reverse(coalesce(j->>'x-forwarded-for', '')), ',', 1)))), 64)
    from h;
$$;

-- Bremse: true, wenn diese IP (5) oder alle zusammen (200) zu viele Fehlversuche hatten (15 Minuten);
-- die hohe globale Grenze verhindert, dass ein Fremder das Koppeln für alle sperrt (Siggi M1)
create or replace function braincraft.pair_blocked()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from braincraft.pair_attempts
           where not ok and ip = braincraft.request_ip() and at > now() - interval '15 minutes') >= 5
      or (select count(*) from braincraft.pair_attempts
           where not ok and at > now() - interval '15 minutes') >= 200;
$$;

-- Ältere Fassung mit zwei Parametern (frühere Probeläufe) entfernen, sonst bliebe eine Überladung
drop function if exists braincraft.device_create(uuid, text);

-- Neues Geräte-Token (32 Byte zufällig) für eine Familie anlegen. Grenzen (Siggi N1): höchstens 10 aktive
-- Geräte und höchstens 30 neue in 30 Tagen je Familie (widerrufene zählen mit); Tausch aus Familien-Code
-- (p_via_code) höchstens 5 je Familie und Tag. Familie gesperrt, damit parallele Aufrufe nicht überholen.
create or replace function braincraft.device_create(p_family uuid, p_name text, p_via_code boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tok text := encode(extensions.gen_random_bytes(32), 'hex'); v_id uuid;
begin
  perform 1 from braincraft.families where id = p_family for update;
  if (select count(*) from braincraft.devices where family_id = p_family and revoked_at is null) >= 10
     or (select count(*) from braincraft.devices
          where family_id = p_family and created_at > now() - interval '30 days') >= 30
     or (coalesce(p_via_code, false) and (select count(*) from braincraft.devices
          where family_id = p_family and via_code and created_at > now() - interval '24 hours') >= 5) then
    raise exception 'limit_reached';
  end if;
  insert into braincraft.devices (family_id, name, token_hash, last_seen_at, via_code)
  values (p_family, left(coalesce(nullif(btrim(p_name), ''), 'Kinder-Gerät'), 40),
          encode(extensions.digest(v_tok, 'sha256'), 'hex'), now(), coalesce(p_via_code, false))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'device_token', v_tok, 'device_id', v_id, 'family_id', p_family);
end $$;

-- ---------------------------------------------------------------------
-- Neue öffentliche Funktionen
-- ---------------------------------------------------------------------

-- Vereinheitlichte Adresse der GOOGLE-Identität des Kontos, nur wenn Google sie als bestätigt meldet
-- (andere Anbieter oder unbestätigte Adressen zählen für Einladungen nicht; leer, wenn keine)
create or replace function braincraft.my_email()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select braincraft.email_norm(i.identity_data->>'email') from auth.identities i
                    where i.user_id = braincraft.me() and i.provider = 'google'
                      and i.identity_data->>'email_verified' = 'true'
                    order by i.created_at limit 1), '');
$$;

-- Nach jeder Anmeldung: Familie des Kontos (oder null). Nimmt KEINE Einladung an (siehe bc_my_invites).
create or replace function public.bc_session()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := braincraft.me(); f uuid;
begin
  select family_id into f from braincraft.family_parents where user_id = u;
  return jsonb_build_object('family_id', f);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Offene Einladungen an die bestätigte Adresse des Kontos (nur solange es keine Familie hat), höchstens 5
create or replace function public.bc_my_invites()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_email text := braincraft.my_email();
begin
  if v_email = '' or exists (select 1 from braincraft.family_parents where user_id = auth.uid()) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'family_id', x.family_id, 'invited_by', x.inviter, 'created_at', x.created_at, 'expires_at', x.expires_at)
      order by x.created_at desc)
    from (select i.family_id, au.email as inviter, i.created_at, i.expires_at
            from braincraft.parent_invites i left join auth.users au on au.id = i.invited_by
           where i.email = v_email and i.expires_at > now()
           order by i.created_at desc limit 5) x), '[]'::jsonb);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Einladung sichtbar annehmen: nur ohne Familie, nur mit passender bestätigter Adresse, höchstens 4 Eltern
create or replace function public.bc_invite_accept(p_family_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := braincraft.me(); v_email text := braincraft.my_email();
begin
  if v_email = '' then raise exception 'invite_not_found'; end if;
  if exists (select 1 from braincraft.family_parents where user_id = u) then raise exception 'has_family'; end if;
  perform 1 from braincraft.parent_invites
   where family_id = p_family_id and email = v_email and expires_at > now() for update;
  if not found then raise exception 'invite_not_found'; end if;
  -- Familie sperren, damit die Eltern-Grenze auch bei parallelen Annahmen hält
  perform 1 from braincraft.families where id = p_family_id for update;
  if (select count(*) from braincraft.family_parents where family_id = p_family_id) >= 4 then
    raise exception 'limit_reached';
  end if;
  insert into braincraft.family_parents (family_id, user_id) values (p_family_id, u);
  -- Ein Konto gehört zu einer Familie: alle Einladungen an diese Adresse sind erledigt
  delete from braincraft.parent_invites where email = v_email;
  return jsonb_build_object('family_id', p_family_id);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Einladung ablehnen (nur die eigene)
create or replace function public.bc_invite_decline(p_family_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_email text := braincraft.my_email();
begin
  delete from braincraft.parent_invites where family_id = p_family_id and email = v_email and v_email <> '';
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Neue Familie für das angemeldete Konto (nur ohne Familie): erstes Kind und Eltern-PIN (4 Ziffern, bcrypt).
-- Ersetzt bc_create mit Einladungscode. Grenzen: höchstens 20 Familien insgesamt, 3 neue je 24 h (Siggi).
create or replace function public.bc_family_create(p_child_name text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := braincraft.me(); f uuid; k uuid;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  -- Nacheinander statt parallel (Grenzen und „nur eine Familie je Konto“)
  perform pg_advisory_xact_lock(hashtext('braincraft.family_create'));
  if exists (select 1 from braincraft.family_parents where user_id = u) then raise exception 'has_family'; end if;
  if (select count(*) from braincraft.families) >= 20
     or (select count(*) from braincraft.families where created_at > now() - interval '24 hours') >= 3 then
    raise exception 'limit_reached';
  end if;
  -- ohne code_hash (die Spalte entfällt mit 008)
  insert into braincraft.families (pin_hash)
  values (extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  returning id into f;
  insert into braincraft.profiles (family_id, child_name) values (f, btrim(p_child_name)) returning id into k;
  insert into braincraft.family_parents (family_id, user_id) values (f, u);
  return jsonb_build_object('family_id', f, 'profile_id', k);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Eltern und offene Einladungen der Familie (nur mit Eltern-Token)
create or replace function public.bc_parents(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token); u uuid := auth.uid();
begin
  return jsonb_build_object(
    'parents', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', fp.user_id, 'email', au.email, 'is_me', fp.user_id = u, 'added_at', fp.added_at)
        order by fp.added_at)
      from braincraft.family_parents fp join auth.users au on au.id = fp.user_id
     where fp.family_id = f), '[]'),
    'invites', coalesce((select jsonb_agg(jsonb_build_object(
        'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at)
      from braincraft.parent_invites i where i.family_id = f and i.expires_at > now()), '[]'));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Weiteres Elternteil per Gmail-Adresse einladen (nur mit Eltern-Token)
create or replace function public.bc_parent_invite(p_token text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token); v text := braincraft.email_norm(p_email);
begin
  if length(v) > 254 or v !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'bad_email'; end if;
  if exists (select 1 from braincraft.family_parents fp join auth.users au on au.id = fp.user_id
              where fp.family_id = f and braincraft.email_norm(au.email) = v) then
    raise exception 'already_parent';
  end if;
  perform 1 from braincraft.families where id = f for update;
  delete from braincraft.parent_invites where family_id = f and expires_at <= now();
  if (select count(*) from braincraft.parent_invites where family_id = f and email <> v) >= 5
     or (select count(*) from braincraft.family_parents where family_id = f) >= 4 then
    raise exception 'limit_reached';
  end if;
  insert into braincraft.parent_invites (family_id, email, invited_by) values (f, v, auth.uid())
  on conflict (family_id, email) do update set created_at = now(), expires_at = now() + interval '14 days',
                                               invited_by = excluded.invited_by;
  return jsonb_build_object('ok', true, 'email', v);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

create or replace function public.bc_parent_invite_delete(p_token text, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token);
begin
  delete from braincraft.parent_invites where family_id = f and email = braincraft.email_norm(p_email);
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Anderes Elternteil aus der Familie nehmen (nicht sich selbst, nicht das letzte); beendet alle Eltern-Sitzungen
create or replace function public.bc_parent_remove(p_token text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token);
begin
  if p_user_id is null or p_user_id = auth.uid() then raise exception 'cannot_remove_self'; end if;
  delete from braincraft.family_parents where family_id = f and user_id = p_user_id;
  if not found then raise exception 'not_found'; end if;
  delete from braincraft.parent_sessions where family_id = f;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- Kinder-Geräte koppeln
-- ---------------------------------------------------------------------

-- Eltern-Gerät (Google + PIN): Einmal-Code für ein neues Kinder-Gerät, 10 Minuten, einmal einlösbar.
-- 10 Zeichen aus 31 (ohne 0/O, 1/I/L), als XXXXX-XXXXX; höchstens 3 offene und 20 neue je 24 h je Familie.
create or replace function public.bc_pair_create(p_token text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token);
  v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_code text := ''; v_byte int; v_exp timestamptz;
begin
  if length(btrim(coalesce(p_name, ''))) > 40 then raise exception 'invalid_input'; end if;
  perform 1 from braincraft.families where id = f for update;
  delete from braincraft.pair_codes where family_id = f and (expires_at < now() - interval '1 day');
  if (select count(*) from braincraft.pair_codes where family_id = f and used_at is null and expires_at > now()) >= 3
     or (select count(*) from braincraft.pair_codes where family_id = f and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'limit_reached';
  end if;
  -- Nur Bytes unter 248 (= 8 × 31), damit jedes Zeichen gleich wahrscheinlich ist (Siggi N7)
  while length(v_code) < 10 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if v_byte < 248 then v_code := v_code || substr(v_alpha, (v_byte % 31) + 1, 1); end if;
  end loop;
  v_exp := now() + interval '10 minutes';
  insert into braincraft.pair_codes (code_hash, family_id, created_by, name, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), f, auth.uid(),
          left(coalesce(nullif(btrim(p_name), ''), 'Kinder-Gerät'), 40), v_exp);
  return jsonb_build_object('code', substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5), 'expires_at', v_exp);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Kinder-Gerät (anon): Einmal-Code einlösen → Geräte-Token. Fehlversuche werden gezählt (kein raise,
-- sonst ginge der Eintrag mit der Rücknahme verloren); Antwort {ok:false, error:'pair_invalid'|'pair_blocked'}.
-- (Parameter heißt p_pair_code, nicht p_code: 008 entfernt alle Funktionen mit p_code)
create or replace function public.bc_pair_redeem(p_pair_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := upper(regexp_replace(left(coalesce(p_pair_code, ''), 40), '[^A-Za-z0-9]', '', 'g'));
  r braincraft.pair_codes; v_dev jsonb;
begin
  delete from braincraft.pair_attempts where at < now() - interval '1 day';
  if braincraft.pair_blocked() then return jsonb_build_object('ok', false, 'error', 'pair_blocked'); end if;
  select * into r from braincraft.pair_codes
   where length(v) = 10 and code_hash = encode(extensions.digest(v, 'sha256'), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if r.code_hash is null then
    insert into braincraft.pair_attempts (ip, ok) values (braincraft.request_ip(), false);
    return jsonb_build_object('ok', false, 'error', 'pair_invalid');
  end if;
  update braincraft.pair_codes set used_at = now() where code_hash = r.code_hash;
  insert into braincraft.pair_attempts (ip, ok) values (braincraft.request_ip(), true);
  v_dev := braincraft.device_create(r.family_id, r.name);
  return v_dev || jsonb_build_object('name', r.name);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Altgerät (anon, nur bis 008): vorhandenen Familien-Code einmalig gegen ein Geräte-Token tauschen.
-- Gleiche Bremse wie beim Koppeln; der Code gab schon bisher genau diese Kinderrechte.
create or replace function public.bc_device_from_code(p_code text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid;
begin
  delete from braincraft.pair_attempts where at < now() - interval '1 day';
  if braincraft.pair_blocked() then return jsonb_build_object('ok', false, 'error', 'pair_blocked'); end if;
  begin
    f := braincraft.family(p_code);
  exception when others then
    f := null;
  end;
  if f is null then
    insert into braincraft.pair_attempts (ip, ok) values (braincraft.request_ip(), false);
    return jsonb_build_object('ok', false, 'error', 'pair_invalid');
  end if;
  insert into braincraft.pair_attempts (ip, ok) values (braincraft.request_ip(), true);
  return braincraft.device_create(f, coalesce(nullif(btrim(p_name), ''), 'Altes Gerät'), true);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Nach 008 (kein braincraft.family(text) mehr) den Code-Tausch beim erneuten Einspielen gleich wieder entfernen
do $$
begin
  if to_regprocedure('braincraft.family(text)') is null then
    drop function if exists public.bc_device_from_code(text, text);
  end if;
end $$;

-- Kinder-Gerät meldet sich (zuletzt aktiv, höchstens alle 10 Minuten geschrieben); liefert Familie und Name.
-- Widerrufen/unbekannt: device_revoked/device_unknown.
create or replace function public.bc_device_hello()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.my_family(); d braincraft.devices := braincraft.my_device();
begin
  update braincraft.devices set last_seen_at = now()
   where id = d.id and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
  return jsonb_build_object('family_id', f, 'device_id', d.id, 'name', d.name);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Kinder-Gerät trennt sich selbst (Token sofort ungültig)
create or replace function public.bc_device_leave()
returns boolean language plpgsql security definer set search_path = '' as $$
declare d braincraft.devices := braincraft.my_device();
begin
  if d.id is null then return false; end if;
  update braincraft.devices set revoked_at = coalesce(revoked_at, now()) where id = d.id;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Eltern-Gerät (Google + PIN): gekoppelte Geräte der Familie (ohne widerrufene älter als 30 Tage)
create or replace function public.bc_devices(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'created_at', d.created_at, 'last_seen_at', d.last_seen_at,
      'revoked_at', d.revoked_at) order by d.revoked_at nulls first, d.created_at)
    from braincraft.devices d
   where d.family_id = f and (d.revoked_at is null or d.revoked_at > now() - interval '30 days')), '[]'::jsonb);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Eltern-Gerät (Google + PIN): Gerät entfernen, Token sofort ungültig
create or replace function public.bc_device_revoke(p_token text, p_device_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.my_google_parent(p_token);
begin
  update braincraft.devices set revoked_at = now()
   where id = p_device_id and family_id = f and revoked_at is null;
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- Bisherige Funktionen ohne p_code (Logik unverändert aus dem Live-Stand vom 03.11.2026,
-- nur braincraft.family(p_code) → my_family() und braincraft.parent(p_code, p_token) → my_parent(p_token);
-- bc_pull liefert zusätzlich family_id)
-- ---------------------------------------------------------------------

create or replace function public.bc_answer(p_answer_id uuid, p_profile_id uuid, p_question_id uuid, p_correct boolean, p_first_try boolean, p_mode text, p_answered_at timestamp with time zone, p_token text DEFAULT NULL::text, p_device text DEFAULT NULL::text, p_round_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f uuid := braincraft.my_family();
  tz text; v_at timestamptz; v_day date; v_exam date; v_exam_id uuid; pr braincraft.progress%rowtype;
  v_box smallint; v_cc smallint; v_next timestamptz; v_stars integer; v_booked integer := 0; v_frozen boolean;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_answer_id is null or p_correct is null then raise exception 'bad_answer'; end if;
  if exists (select 1 from braincraft.answers where id = p_answer_id and profile_id = p_profile_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_mode is null or p_mode not in ('solo', 'eltern', 'boss', 'chill') then raise exception 'bad_mode'; end if;
  if p_mode = 'eltern' then perform braincraft.my_parent(p_token); end if;
  select e.exam_date, e.id into v_exam, v_exam_id
    from braincraft.questions q join braincraft.exams e on e.id = q.exam_id
   where q.id = p_question_id and e.family_id = f and e.profile_id = p_profile_id
     and q.is_active and q.status = 'freigegeben';
  if not found then raise exception 'question_not_found'; end if;
  if (select count(*) from braincraft.answers a join braincraft.profiles p on p.id = a.profile_id
       where p.family_id = f and a.received_at > now() - interval '24 hours') >= 1500 then
    raise exception 'limit_reached';
  end if;

  -- Zeitpunkt: nicht in der Zukunft, höchstens 30 Tage zurück (Offline-Warteschlange)
  v_at := greatest(least(coalesce(p_answered_at, now()), now()), now() - interval '30 days');
  select timezone into tz from braincraft.families where id = f;
  v_day := (v_at at time zone tz)::date;

  insert into braincraft.answers (id, profile_id, question_id, round_id, correct, first_try, mode, answered_at, device)
  values (p_answer_id, p_profile_id, p_question_id, p_round_id, p_correct, coalesce(p_first_try, true), p_mode, v_at,
          left(p_device, 60))
  on conflict (id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  select * into pr from braincraft.progress
   where profile_id = p_profile_id and question_id = p_question_id for update;

  v_frozen := p_mode in ('boss', 'chill')
           or (v_exam is not null and v_day between v_exam - 1 and v_exam)
           or (pr.profile_id is not null and v_at < pr.last_answered_at);

  if v_frozen then
    -- Leitner-Stand bleibt unverändert; nur die Zähler einer vorhandenen Zeile wachsen
    if pr.profile_id is not null then
      update braincraft.progress
         set correct_count = correct_count + case when p_correct then 1 else 0 end,
             wrong_count   = wrong_count   + case when p_correct then 0 else 1 end
       where profile_id = p_profile_id and question_id = p_question_id;
    end if;
    v_box := pr.leitner_box; v_next := pr.next_review_at;   -- gespeicherter Stand (null, falls nie gesehen)
  else
    if pr.profile_id is null then
      v_box := case when p_correct then 2 else 1 end;
      v_cc  := case when p_correct then 1 else 0 end;
    elsif not p_correct then
      v_box := greatest(pr.leitner_box - 2, 1); v_cc := 0;
    elsif pr.next_review_at <= v_at then
      v_box := least(pr.leitner_box + 1, 5); v_cc := pr.consecutive_correct + 1;
    else
      v_box := pr.leitner_box; v_cc := pr.consecutive_correct;
    end if;

    if not p_correct or v_box = 1 then
      v_next := v_at;
    else
      v_next := (v_day + braincraft.interval_days(v_box))::timestamp at time zone tz;
      if v_exam is not null and v_exam > v_day then
        v_next := greatest(least(v_next, (v_exam - 1)::timestamp at time zone tz), v_at);
      end if;
    end if;

    if pr.profile_id is null then
      insert into braincraft.progress (profile_id, question_id, leitner_box, consecutive_correct,
                                       correct_count, wrong_count, next_review_at, last_answered_at)
      values (p_profile_id, p_question_id, v_box, v_cc,
              case when p_correct then 1 else 0 end, case when p_correct then 0 else 1 end, v_next, v_at);
    else
      update braincraft.progress
         set leitner_box = v_box, consecutive_correct = v_cc, next_review_at = v_next, last_answered_at = v_at,
             correct_count = correct_count + case when p_correct then 1 else 0 end,
             wrong_count   = wrong_count   + case when p_correct then 0 else 1 end
       where profile_id = p_profile_id and question_id = p_question_id;
    end if;
  end if;

  v_stars := case when p_correct and (p_mode = 'eltern' or coalesce(p_first_try, true)) then 1 else 0 end;
  -- Boss nach dem Sieg: weiter spielbar, aber ohne Sterne je Antwort (005)
  if v_stars > 0 and p_mode = 'boss' and exists (
    select 1 from braincraft.boss_wins where profile_id = p_profile_id and exam_id = v_exam_id
  ) then
    v_stars := 0;
  end if;
  if v_stars > 0 then
    v_booked := braincraft.book(p_profile_id, v_stars,
                                case when p_mode = 'eltern' then 'parent_quiz' else 'answer' end, p_answer_id, null);
  end if;

  return jsonb_build_object('ok', true, 'leitner_changed', not v_frozen, 'leitner_box', v_box, 'next_review_at', v_next,
    'stars_booked', v_booked,
    'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_boss_win(p_profile_id uuid, p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family(); v_total integer; v_master integer; v_booked integer; v_item text;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if not exists (select 1 from braincraft.exams where id = p_exam_id and family_id = f and profile_id = p_profile_id) then
    raise exception 'exam_not_found';
  end if;
  if exists (select 1 from braincraft.boss_wins where profile_id = p_profile_id and exam_id = p_exam_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select count(*), count(*) filter (where g.leitner_box >= 3) into v_total, v_master
    from braincraft.questions q
    left join braincraft.progress g on g.question_id = q.id and g.profile_id = p_profile_id
   where q.exam_id = p_exam_id and q.is_active and q.status = 'freigegeben';
  if v_total = 0 or v_master * 10 < v_total * 7 then raise exception 'boss_locked'; end if;

  if (select count(*) from braincraft.inventory where profile_id = p_profile_id) < 100 then
    select it.item_key into v_item from braincraft.items it
     where not exists (select 1 from braincraft.inventory i where i.profile_id = p_profile_id and i.item_key = it.item_key)
     order by it.sort limit 1;
  end if;
  insert into braincraft.boss_wins (profile_id, exam_id, item_key) values (p_profile_id, p_exam_id, v_item)
  on conflict do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_item is not null then
    insert into braincraft.inventory (profile_id, item_key, exam_id) values (p_profile_id, v_item, p_exam_id)
    on conflict (profile_id, item_key) do nothing;
  end if;
  v_booked := braincraft.book(p_profile_id, 10, 'boss', p_exam_id, null);
  return jsonb_build_object('ok', true, 'item_key', v_item, 'stars_booked', v_booked,
    'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_exam_delete(p_token text, p_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v_prefixes text[];
begin
  select coalesce(array_agg(j.family_id::text || '/' || j.id::text || '/'), '{}') into v_prefixes
    from braincraft.scan_jobs j where j.exam_id = p_id and j.family_id = f and j.images_deleted_at is null;
  delete from braincraft.exams where id = p_id and family_id = f;
  if not found then raise exception 'not_found'; end if;
  return v_prefixes;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_exam_save(p_token text, p_id uuid, p_profile_id uuid, p_subject_id uuid, p_title text, p_exam_date date, p_is_archived boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v uuid;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if not exists (select 1 from braincraft.subjects where id = p_subject_id and family_id = f) then
    raise exception 'subject_not_found';
  end if;
  if p_id is not null and exists (select 1 from braincraft.exams where id = p_id and family_id = f) then
    update braincraft.exams
       set profile_id = p_profile_id, subject_id = p_subject_id, title = btrim(p_title), exam_date = p_exam_date,
           is_archived = coalesce(p_is_archived, false), updated_at = now()
     where id = p_id and family_id = f;
    return p_id;
  end if;
  if (select count(*) from braincraft.exams where family_id = f) >= 200 then raise exception 'limit_reached'; end if;
  insert into braincraft.exams (id, family_id, profile_id, subject_id, title, exam_date, is_archived)
  values (coalesce(p_id, gen_random_uuid()), f, p_profile_id, p_subject_id, btrim(p_title), p_exam_date, coalesce(p_is_archived, false))
  returning id into v;
  return v;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_family_delete(p_token text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v jsonb; v_prefixes text[];
begin
  v := braincraft.pin_verify(f, p_pin);
  if not (v->>'ok')::boolean then return v; end if;
  select coalesce(array_agg(j.family_id::text || '/' || j.id::text || '/'), '{}') into v_prefixes
    from braincraft.scan_jobs j where j.family_id = f and j.images_deleted_at is null;
  delete from braincraft.families where id = f;
  return jsonb_build_object('ok', true, 'scan_prefixes', to_jsonb(v_prefixes));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_parent_check(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return braincraft.my_parent(p_token);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_parent_lock(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family();
begin
  if p_token is not null and length(p_token) <= 128 then
    delete from braincraft.parent_sessions
     where family_id = f and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_parent_unlock(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family(); v jsonb; v_tok text;
begin
  v := braincraft.pin_verify(f, p_pin);
  if not (v->>'ok')::boolean then return v; end if;
  delete from braincraft.parent_sessions where family_id = f and expires_at <= now();
  if (select count(*) from braincraft.parent_sessions where family_id = f) >= 10 then
    delete from braincraft.parent_sessions where token_hash = (
      select token_hash from braincraft.parent_sessions where family_id = f order by expires_at limit 1);
  end if;
  v_tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into braincraft.parent_sessions (token_hash, family_id, expires_at)
  values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), f, now() + interval '15 minutes');
  return jsonb_build_object('ok', true, 'token', v_tok, 'expires_at', now() + interval '15 minutes');
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_pin_set(p_token text, p_pin text, p_new_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v jsonb;
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  v := braincraft.pin_verify(f, p_pin);
  if not (v->>'ok')::boolean then return v; end if;
  update braincraft.families
     set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)), pin_fails = 0, pin_locked_until = null
   where id = f;
  delete from braincraft.parent_sessions where family_id = f;   -- alle Eltern-Sitzungen beenden
  return jsonb_build_object('ok', true);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_profile_delete(p_token text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token);
begin
  if (select count(*) from braincraft.profiles where family_id = f) <= 1 then raise exception 'last_profile'; end if;
  delete from braincraft.profiles where id = p_id and family_id = f;
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_profile_save(p_token text, p_id uuid, p_child_name text, p_avatar_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v uuid;
begin
  if p_id is not null and exists (select 1 from braincraft.profiles where id = p_id and family_id = f) then
    update braincraft.profiles
       set child_name = btrim(p_child_name), avatar_id = coalesce(p_avatar_id, avatar_id), updated_at = now()
     where id = p_id and family_id = f;
    return p_id;
  end if;
  if (select count(*) from braincraft.profiles where family_id = f) >= 5 then raise exception 'limit_reached'; end if;
  insert into braincraft.profiles (id, family_id, child_name, avatar_id)
  values (coalesce(p_id, gen_random_uuid()), f, btrim(p_child_name), coalesce(p_avatar_id, 'pilot'))
  returning id into v;
  return v;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_progress_reset(p_token text, p_pin text, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v jsonb; v_ids uuid[]; v_n integer;
begin
  if p_profile_id is not null then perform braincraft.need_profile(f, p_profile_id); end if;
  -- Familie sperren: Bremse und PIN-Prüfung laufen nacheinander, nicht parallel
  perform 1 from braincraft.families where id = f for update;
  if (select count(*) from braincraft.progress_resets
       where family_id = f and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limit_reached';
  end if;
  v := braincraft.pin_verify(f, p_pin);
  if not (v->>'ok')::boolean then return v; end if;

  -- Kinder sperren (wie book()), damit keine Buchung zwischen Löschen und Nullsetzen landet
  select coalesce(array_agg(id order by id), '{}') into v_ids from (
    select id from braincraft.profiles
     where family_id = f and (p_profile_id is null or id = p_profile_id)
     order by id for update) s;
  v_n := cardinality(v_ids);

  delete from braincraft.progress     where profile_id = any(v_ids);
  delete from braincraft.answers      where profile_id = any(v_ids);
  delete from braincraft.unit_views   where profile_id = any(v_ids);
  delete from braincraft.star_ledger  where profile_id = any(v_ids);
  delete from braincraft.inventory    where profile_id = any(v_ids);
  delete from braincraft.boss_wins    where profile_id = any(v_ids);
  delete from braincraft.redemptions  where profile_id = any(v_ids);
  update braincraft.profiles set stars_balance = 0, updated_at = now() where id = any(v_ids);

  delete from braincraft.progress_resets where family_id = f and created_at < now() - interval '30 days';
  insert into braincraft.progress_resets (family_id, profile_id, profiles) values (f, p_profile_id, v_n);
  return jsonb_build_object('ok', true, 'profiles', v_n, 'reset_at', now());
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_pull(p_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family(); tz text; v_parent boolean; v_today date; v_week_start timestamptz;
begin
  select timezone into tz from braincraft.families where id = f;
  v_parent := braincraft.is_parent(f, p_token);
  v_today := (now() at time zone tz)::date;
  v_week_start := (date_trunc('week', v_today::timestamp))::timestamp at time zone tz;
  return jsonb_build_object(
    'server_time', now(),
    'family_id', f,
    'timezone', tz,
    'today', v_today,
    'parent', v_parent,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'child_name', p.child_name, 'avatar_id', p.avatar_id, 'stars_balance', p.stars_balance,
        'stars_today', (select coalesce(sum(l.delta), 0) from braincraft.star_ledger l
                         where l.profile_id = p.id and l.delta > 0
                           and l.reason in ('answer', 'round', 'parent_quiz')
                           and l.created_at >= v_today::timestamp at time zone tz),
        'learn_days_week', (select count(distinct (a.answered_at at time zone tz)::date) from braincraft.answers a
                             where a.profile_id = p.id and a.answered_at >= v_week_start))
        order by p.created_at)
      from braincraft.profiles p where p.family_id = f), '[]'),
    'subjects', coalesce((select jsonb_agg(to_jsonb(s) - 'family_id' order by s.name)
      from braincraft.subjects s where s.family_id = f), '[]'),
    'exams', coalesce((select jsonb_agg(to_jsonb(e) - 'family_id' order by e.exam_date nulls last)
      from braincraft.exams e where e.family_id = f), '[]'),
    'units', coalesce((select jsonb_agg(to_jsonb(u) - 'scan_job_id')
      from braincraft.learning_units u join braincraft.exams e on e.id = u.exam_id where e.family_id = f), '[]'),
    'unit_views', coalesce((select jsonb_agg(jsonb_build_object(
        'profile_id', v.profile_id, 'unit_id', v.unit_id, 'seen_at', v.seen_at))
      from braincraft.unit_views v join braincraft.profiles p on p.id = v.profile_id where p.family_id = f), '[]'),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'exam_id', q.exam_id, 'unit_id', q.unit_id, 'type', q.type, 'prompt', q.prompt,
        'payload', q.payload, 'status', q.status, 'slide_index', q.slide_index))
      from braincraft.questions q join braincraft.exams e on e.id = q.exam_id
      where e.family_id = f and q.is_active and (v_parent or q.status = 'freigegeben')), '[]'),
    'progress', coalesce((select jsonb_agg(to_jsonb(g))
      from braincraft.progress g join braincraft.profiles p on p.id = g.profile_id where p.family_id = f), '[]'),
    'rewards', coalesce((select jsonb_agg(to_jsonb(r) - 'family_id' order by r.cost_stars)
      from braincraft.rewards r where r.family_id = f and (r.is_active or v_parent)), '[]'),
    'redemptions', coalesce((select jsonb_agg(to_jsonb(d) order by d.redeemed_at desc)
      from braincraft.redemptions d join braincraft.profiles p on p.id = d.profile_id
      where p.family_id = f and (d.status = 'offen' or d.resolved_at > now() - interval '60 days')), '[]'),
    'items', coalesce((select jsonb_agg(to_jsonb(it) order by it.sort) from braincraft.items it), '[]'),
    'inventory', coalesce((select jsonb_agg(to_jsonb(i))
      from braincraft.inventory i join braincraft.profiles p on p.id = i.profile_id where p.family_id = f), '[]'),
    'boss_wins', coalesce((select jsonb_agg(to_jsonb(b))
      from braincraft.boss_wins b join braincraft.profiles p on p.id = b.profile_id where p.family_id = f), '[]'),
    'scan_jobs', case when v_parent then coalesce((select jsonb_agg(to_jsonb(j) - 'family_id' order by j.created_at desc)
      from braincraft.scan_jobs j where j.family_id = f and j.created_at > now() - interval '30 days'), '[]') end
  );
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_question_save(p_token text, p_id uuid, p_prompt text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token);
begin
  update braincraft.questions q set prompt = btrim(p_prompt), payload = p_payload, updated_at = now()
   where q.id = p_id and exists (select 1 from braincraft.exams e where e.id = q.exam_id and e.family_id = f);
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_question_set_active(p_token text, p_id uuid, p_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token);
begin
  update braincraft.questions q set is_active = coalesce(p_active, false), updated_at = now()
   where q.id = p_id and exists (select 1 from braincraft.exams e where e.id = q.exam_id and e.family_id = f);
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_question_set_status(p_token text, p_ids uuid[], p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); n integer;
begin
  if p_status is null or p_status not in ('entwurf', 'freigegeben') then raise exception 'bad_status'; end if;
  if cardinality(coalesce(p_ids, '{}')) > 300 then raise exception 'limit_reached'; end if;
  update braincraft.questions q set status = p_status, updated_at = now()
   where q.id = any(p_ids) and exists (select 1 from braincraft.exams e where e.id = q.exam_id and e.family_id = f);
  get diagnostics n = row_count;
  return n;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_redeem(p_redemption_id uuid, p_profile_id uuid, p_reward_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family(); r record; v_booked integer;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_redemption_id is null then raise exception 'bad_redemption'; end if;
  if exists (select 1 from braincraft.redemptions where id = p_redemption_id and profile_id = p_profile_id) then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
  end if;
  select id, title, cost_stars into r from braincraft.rewards
   where id = p_reward_id and family_id = f and is_active and (profile_id is null or profile_id = p_profile_id);
  if r.id is null then raise exception 'reward_not_found'; end if;
  if (select count(*) from braincraft.redemptions where profile_id = p_profile_id and status = 'offen') >= 20
     or (select count(*) from braincraft.redemptions
          where profile_id = p_profile_id and redeemed_at > now() - interval '24 hours') >= 50 then
    raise exception 'limit_reached';
  end if;
  -- book() sperrt das Kind (FOR UPDATE) und wirft not_enough_stars; zweiter Aufruf mit gleicher ID bucht nicht
  v_booked := braincraft.book(p_profile_id, -r.cost_stars, 'redeem', p_redemption_id, r.title);
  if v_booked <> 0 then
    insert into braincraft.redemptions (id, profile_id, reward_id, reward_title, cost_stars)
    values (p_redemption_id, p_profile_id, r.id, r.title, r.cost_stars);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', v_booked = 0,
    'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_redemption_resolve(p_token text, p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); r record;
begin
  if p_status is null or p_status not in ('erledigt', 'storniert') then raise exception 'bad_status'; end if;
  select d.* into r from braincraft.redemptions d join braincraft.profiles p on p.id = d.profile_id
   where d.id = p_id and p.family_id = f for update of d;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'offen' then return jsonb_build_object('ok', true, 'status', r.status); end if;
  update braincraft.redemptions set status = p_status, resolved_at = now() where id = p_id;
  if p_status = 'storniert' then
    perform braincraft.book(r.profile_id, r.cost_stars, 'refund', p_id, r.reward_title);
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_reward_delete(p_token text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token);
begin
  delete from braincraft.rewards where id = p_id and family_id = f;
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_reward_save(p_token text, p_id uuid, p_profile_id uuid, p_title text, p_icon text, p_cost_stars integer, p_is_active boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v uuid;
begin
  if p_profile_id is not null then perform braincraft.need_profile(f, p_profile_id); end if;
  if p_id is not null and exists (select 1 from braincraft.rewards where id = p_id and family_id = f) then
    update braincraft.rewards
       set profile_id = p_profile_id, title = btrim(p_title), icon = coalesce(p_icon, icon),
           cost_stars = p_cost_stars, is_active = coalesce(p_is_active, true), updated_at = now()
     where id = p_id and family_id = f;
    return p_id;
  end if;
  if (select count(*) from braincraft.rewards where family_id = f) >= 50 then raise exception 'limit_reached'; end if;
  insert into braincraft.rewards (id, family_id, profile_id, title, icon, cost_stars, is_active)
  values (coalesce(p_id, gen_random_uuid()), f, p_profile_id, btrim(p_title), coalesce(p_icon, 'gamepad-2'),
          p_cost_stars, coalesce(p_is_active, true))
  returning id into v;
  return v;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_round_finish(p_round_id uuid, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family(); v_booked integer;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_round_id is null then raise exception 'bad_round'; end if;
  if (select count(*) from braincraft.answers
       where profile_id = p_profile_id and round_id = p_round_id
         and mode in ('solo', 'chill')) < 5 then
    raise exception 'round_too_short';
  end if;
  v_booked := braincraft.book(p_profile_id, 3, 'round', p_round_id, null);
  return jsonb_build_object('ok', true, 'stars_booked', v_booked,
    'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_scan_start(p_token text, p_exam_id uuid, p_image_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v uuid;
begin
  if not exists (select 1 from braincraft.exams where id = p_exam_id and family_id = f) then
    raise exception 'exam_not_found';
  end if;
  if p_image_count is null or p_image_count not between 1 and 10 then raise exception 'bad_image_count'; end if;
  if (select count(*) from braincraft.scan_jobs where family_id = f and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'limit_reached';
  end if;
  insert into braincraft.scan_jobs (family_id, exam_id, image_count) values (f, p_exam_id, p_image_count)
  returning id into v;
  return jsonb_build_object('job_id', v, 'family_id', f, 'prefix', f::text || '/' || v::text || '/');
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_stars_correct(p_token text, p_profile_id uuid, p_delta integer, p_note text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token);
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_delta is null or p_delta = 0 or abs(p_delta) > 10000 then raise exception 'bad_delta'; end if;
  if (select count(*) from braincraft.star_ledger l join braincraft.profiles p on p.id = l.profile_id
       where p.family_id = f and l.reason = 'correction' and l.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'limit_reached';
  end if;
  perform braincraft.book(p_profile_id, p_delta, 'correction', null, coalesce(p_note, ''));
  return (select stars_balance from braincraft.profiles where id = p_profile_id);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_subject_delete(p_token text, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token);
begin
  if exists (select 1 from braincraft.exams where subject_id = p_id and family_id = f) then
    raise exception 'subject_in_use';
  end if;
  delete from braincraft.subjects where id = p_id and family_id = f;
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_subject_save(p_token text, p_id uuid, p_name text, p_icon text, p_color_theme text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v uuid;
begin
  if p_id is not null and exists (select 1 from braincraft.subjects where id = p_id and family_id = f) then
    update braincraft.subjects set name = btrim(p_name), icon = p_icon, color_theme = p_color_theme
     where id = p_id and family_id = f;
    return p_id;
  end if;
  if (select count(*) from braincraft.subjects where family_id = f) >= 30 then raise exception 'limit_reached'; end if;
  insert into braincraft.subjects (id, family_id, name, icon, color_theme)
  values (coalesce(p_id, gen_random_uuid()), f, btrim(p_name), p_icon, p_color_theme) returning id into v;
  return v;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_unit_import(p_token text, p_exam_id uuid, p_scan_job_id uuid, p_slides jsonb, p_questions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_parent(p_token); v_unit uuid; q record; v_new integer; v_nslides integer;
begin
  if not exists (select 1 from braincraft.exams where id = p_exam_id and family_id = f) then
    raise exception 'exam_not_found';
  end if;
  if p_scan_job_id is not null and not exists (
    select 1 from braincraft.scan_jobs where id = p_scan_job_id and family_id = f and exam_id = p_exam_id) then
    raise exception 'scan_not_found';
  end if;
  if p_slides is null or jsonb_typeof(p_slides) <> 'array' or jsonb_array_length(p_slides) > 8
     or pg_column_size(p_slides) > 20000 then
    raise exception 'bad_slides';
  end if;
  if exists (select 1 from jsonb_array_elements(p_slides) s
             where jsonb_typeof(s) <> 'object' or length(coalesce(s->>'title', '')) = 0
                or length(coalesce(s->>'content', '')) = 0) then
    raise exception 'bad_slides';
  end if;
  v_nslides := jsonb_array_length(p_slides);
  if p_questions is null or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) not between 1 and 80 or pg_column_size(p_questions) > 700000 then
    raise exception 'bad_questions';
  end if;
  for q in select e.value, e.ordinality from jsonb_array_elements(p_questions) with ordinality e loop
    if jsonb_typeof(q.value) <> 'object'
       or coalesce(q.value->>'type', '') not in (select unnest(enum_range(null::braincraft.question_type))::text)
       or not braincraft.payload_ok((q.value->>'type')::braincraft.question_type, q.value->'payload')
       or char_length(btrim(coalesce(q.value->>'prompt', ''))) not between 1 and 500 then
      raise exception 'bad_question %', q.ordinality;
    end if;
  end loop;

  -- neue (nicht doppelte) Fragen zählen: Typ + Text + payload (jsonb-Gleichheit), slide zählt nicht
  select count(*) into v_new from (
    select distinct lower(btrim(x->>'prompt')), x->>'type', x->'payload'
      from jsonb_array_elements(p_questions) x
     where not exists (select 1 from braincraft.questions o
                        where o.exam_id = p_exam_id and o.is_active
                          and o.type = (x->>'type')::braincraft.question_type
                          and lower(o.prompt) = lower(btrim(x->>'prompt'))
                          and o.payload = x->'payload')) c;
  if v_new = 0 then
    return jsonb_build_object('unit_id', null, 'inserted', 0);
  end if;

  -- Grenzen je Familie und Klassenarbeit, deaktivierte Fragen zählen mit
  if (select count(*) from braincraft.learning_units u join braincraft.exams e on e.id = u.exam_id
       where e.family_id = f) >= 1000
     or (select count(*) from braincraft.questions qq join braincraft.exams e on e.id = qq.exam_id
          where e.family_id = f) + v_new > 3000
     or (select count(*) from braincraft.questions where exam_id = p_exam_id) + v_new > 300 then
    raise exception 'limit_reached';
  end if;

  insert into braincraft.learning_units (exam_id, scan_job_id, summary_slides)
  values (p_exam_id, p_scan_job_id, p_slides) returning id into v_unit;

  -- slide nur als ganze JSON-Zahl im Folienbereich, sonst null; bei Duplikaten im Import gewinnt
  -- das erste Vorkommen (order by ordinality)
  insert into braincraft.questions (exam_id, unit_id, type, prompt, payload, status, slide_index)
  select distinct on (lower(btrim(x.value->>'prompt')), x.value->>'type', x.value->'payload')
         p_exam_id, v_unit, (x.value->>'type')::braincraft.question_type, btrim(x.value->>'prompt'),
         x.value->'payload', 'entwurf',
         case when jsonb_typeof(x.value->'slide') = 'number' then    -- verschachtelt: Cast nur bei Zahl
           case when (x.value->'slide')::numeric = trunc((x.value->'slide')::numeric)
                     and (x.value->'slide')::numeric >= 0 and (x.value->'slide')::numeric < v_nslides
                then (x.value->'slide')::numeric::smallint end end
    from jsonb_array_elements(p_questions) with ordinality x
   where not exists (select 1 from braincraft.questions o
                      where o.exam_id = p_exam_id and o.is_active
                        and o.type = (x.value->>'type')::braincraft.question_type
                        and lower(o.prompt) = lower(btrim(x.value->>'prompt'))
                        and o.payload = x.value->'payload')
   order by lower(btrim(x.value->>'prompt')), x.value->>'type', x.value->'payload', x.ordinality;
  get diagnostics v_new = row_count;
  return jsonb_build_object('unit_id', v_unit, 'inserted', v_new);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

create or replace function public.bc_unit_seen(p_profile_id uuid, p_unit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f uuid := braincraft.my_family(); v_seen timestamptz;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if not exists (select 1 from braincraft.learning_units u join braincraft.exams e on e.id = u.exam_id
                  where u.id = p_unit_id and e.family_id = f
                    and e.profile_id = p_profile_id) then  -- nur Kapitel dieses Kindes (Siggi N-a)
    raise exception 'unit_not_found';
  end if;
  select seen_at into v_seen from braincraft.unit_views where profile_id = p_profile_id and unit_id = p_unit_id;
  if v_seen is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'seen_at', v_seen);
  end if;
  -- Grenze je Kind; Zeilensperre auf dem Profil, damit parallele Aufrufe sie nicht überschreiten
  perform 1 from braincraft.profiles where id = p_profile_id for update;
  if (select count(*) from braincraft.unit_views where profile_id = p_profile_id) >= 1000 then
    raise exception 'limit_reached';
  end if;
  insert into braincraft.unit_views (profile_id, unit_id) values (p_profile_id, p_unit_id)
  on conflict do nothing returning seen_at into v_seen;
  if v_seen is null then
    select seen_at into v_seen from braincraft.unit_views where profile_id = p_profile_id and unit_id = p_unit_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'seen_at', v_seen);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'seen_at', v_seen);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $function$;

-- ---------------------------------------------------------------------
-- Bestandsfamilie Marcos Konto zuordnen (auth.users-ID, per SELECT am 03.11.2026 ermittelt:
-- das bestätigte Konto mit Gmail-Adresse). Meldet sich Marco mit Google und derselben
-- Gmail-Adresse an, verknüpft Supabase die Google-Identität mit diesem Konto (gleiche ID).
-- ---------------------------------------------------------------------
do $$
declare v_user uuid := '842f08e5-0b21-4941-ab50-fcee70d794e9'; n integer;
begin
  select count(*) into n from braincraft.families;
  if n = 0 or exists (select 1 from braincraft.family_parents) then
    return;   -- nichts zu übernehmen oder schon zugeordnet (erneuter Lauf)
  end if;
  if n > 1 then
    raise exception 'BrainCraft 007: % Familien gefunden, erwartet 1. Zuordnung bitte von Hand festlegen.', n;
  end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'BrainCraft 007: Konto % fehlt oder ist nicht bestätigt.', v_user;
  end if;
  insert into braincraft.family_parents (family_id, user_id)
  select id, v_user from braincraft.families
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Rechte (Siggi N5): Tabellen und Helfer für niemanden; Funktionen mit p_code wie bisher (bis 008),
-- Konto-Funktionen nur für authenticated, Kinder-/PIN-Funktionen auch für anon (Geräte-Token).
-- ---------------------------------------------------------------------
revoke all on all tables    in schema braincraft from public, anon, authenticated;
revoke all on all sequences in schema braincraft from public, anon, authenticated;
revoke all on all functions in schema braincraft from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname, coalesce('p_code' = any(p.proargnames), false) as legacy
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and left(p.proname, 3) = 'bc_' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('bc_pin_reset', 'bc_scan_update', 'bc_scan_stale', 'bc_invite_create',
                     'bc_scan_tick', 'bc_scan_orphans', 'bc_cron_secret') then
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.legacy or r.proname = 'bc_create' then
      execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
    elsif r.proname in ('bc_session', 'bc_my_invites', 'bc_invite_accept', 'bc_invite_decline', 'bc_family_create',
                        'bc_parents', 'bc_parent_invite', 'bc_parent_invite_delete', 'bc_parent_remove',
                        'bc_pair_create', 'bc_devices', 'bc_device_revoke') then
      -- Konto-Funktionen: nur mit Google-Sitzung
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    else
      -- Kinder- und PIN-Funktionen: Kinder-Gerät (anon + Geräte-Token) und Eltern-Gerät
      execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;
