-- =====================================================================
-- BrainCraft 006: Fortschritt zurücksetzen (Eltern-Cockpit „Alles zurücksetzen“)
-- Entwurf von Daten-Dieter, Stand 29.10.2026 (Wunsch von Marco: alle Sterne und Fortschritt löschen).
-- Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. Setzt 001-005 voraus (live seit 005). NOCH NICHT EINGESPIELT.
-- Datei ohne begin/commit: Einspielen in EINER Transaktion (z. B. CLI-Lauf als ein DO-Block oder
-- SQL-Editor mit eigenem begin/commit drumherum).
--
--  * Neue Tabelle braincraft.progress_resets: ein Eintrag je Zurücksetzung (Familie, Kind oder null
--    = alle, Anzahl Kinder, Zeitpunkt). Nur für die Bremse und zum Nachvollziehen; Einträge älter
--    als 30 Tage löscht die Funktion selbst. RLS an, keine Policies, keine Tabellenrechte.
--  * Neue Funktion public.bc_progress_reset(p_code, p_token, p_pin, p_profile_id) -> jsonb:
--      - Eltern-Token (sonst pin_required) UND aktuelle PIN über braincraft.pin_verify
--        (falsche PIN / Sperre: dessen Ergebnis {ok:false, error, locked_until}, kein raise,
--        damit der Fehlzähler bleibt; Siggi M1/M3, wie bc_family_delete)
--      - p_profile_id = ein Kind der eigenen Familie (sonst profile_not_found) oder null = alle Kinder
--      - Bremse: höchstens 5 Zurücksetzungen je Familie in 24 h (limit_reached); geprüft VOR der PIN,
--        damit die Bremse keine PIN-Versuche verbraucht und parallele Aufrufe sie nicht überholen
--        (Zeilensperre auf der Familie)
--      - löscht für die betroffenen Kinder: progress, answers, unit_views, star_ledger, inventory,
--        boss_wins, redemptions (auch offene Gutscheine); profiles.stars_balance = 0
--      - bleibt: Familie, Kinder, PIN, Eltern-Sitzungen, Fächer, Klassenarbeiten, Lerneinheiten,
--        Fragen (mit Freigabe-Status), Belohnungen, Scan-Aufträge, Teile-Liste
--      - Rückgabe {ok:true, profiles:n, reset_at}
--  * Keine Änderung an bestehenden Funktionen oder Zeilen.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, Rechte-Schleife wie 003-005 (Siggi N5).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Protokoll für die Bremse
-- ---------------------------------------------------------------------
create table if not exists braincraft.progress_resets (
  id         bigint generated always as identity primary key,
  family_id  uuid not null references braincraft.families(id) on delete cascade,
  profile_id uuid references braincraft.profiles(id) on delete set null,   -- null = alle Kinder
  profiles   smallint not null check (profiles >= 0),
  created_at timestamptz not null default now()
);
create index if not exists progress_resets_family_idx on braincraft.progress_resets (family_id, created_at);
create index if not exists progress_resets_profile_idx on braincraft.progress_resets (profile_id) where profile_id is not null;
alter table braincraft.progress_resets enable row level security;

-- ---------------------------------------------------------------------
-- Fortschritt zurücksetzen (Eltern: Token + PIN)
-- ---------------------------------------------------------------------
create or replace function public.bc_progress_reset(p_code text, p_token text, p_pin text, p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v jsonb; v_ids uuid[]; v_n integer;
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
end $$;

-- ---------------------------------------------------------------------
-- Rechte: wie 003-005 (Siggi N5)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema braincraft from public, anon, authenticated;
revoke all on all sequences in schema braincraft from public, anon, authenticated;
revoke all on all functions in schema braincraft from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'bc\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('bc_pin_reset', 'bc_scan_update', 'bc_scan_stale', 'bc_invite_create',
                     'bc_scan_tick', 'bc_scan_orphans', 'bc_cron_secret') then
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;
