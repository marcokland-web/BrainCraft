-- =====================================================================
-- BrainCraft 008: Familien-Code und Einladungscode entfernen (NACH der Auslieferung)
-- Stand 03.11.2026. Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. NOCH NICHT EINGESPIELT.
-- Erst einspielen, wenn
--   1. 007 eingespielt ist,
--   2. die App mit Google-Anmeldung ausgeliefert ist und
--   3. jedes Gerät (Kinder-iPad, Eltern-Handys) die neue Version geladen und sich einmal mit
--      Google angemeldet hat (Kontrolle: select count(*) from braincraft.family_parents;
--      die alten Funktionen werden dann nicht mehr aufgerufen – siehe API-Logs nach "p_code").
-- Danach findet eine alte, noch zwischengespeicherte App-Version ihre Funktionen nicht mehr
-- (missing_function) und zeigt nach dem Update die Google-Anmeldung.
-- Datei ohne begin/commit: in EINER Transaktion einspielen.
--
--  * Entfernt alle public.bc_*-Funktionen mit Parameter p_code (darunter bc_device_from_code, der
--    einmalige Tausch Familien-Code → Geräte-Token für Altgeräte), bc_create und bc_invite_create.
--    Altgeräte, die bis dahin nicht getauscht haben, werden vom Eltern-Gerät neu gekoppelt.
--  * Entfernt die Helfer braincraft.family(text), braincraft.parent(text, text), braincraft.norm_code(text).
--  * Entfernt Tabelle braincraft.invites und Spalte families.code_hash.
--  * bc_scan_check(p_code, …) aus 002 gibt es nur, falls 002 je eingespielt wurde; wird mit entfernt.
-- =====================================================================

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and left(p.proname, 3) = 'bc_'
              and ('p_code' = any(p.proargnames) or p.proname in ('bc_create', 'bc_invite_create')) loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

drop function if exists braincraft.parent(text, text);
drop function if exists braincraft.family(text);
drop function if exists braincraft.norm_code(text);

-- Aufräum-Zeitplan aus 001 löscht in braincraft.invites: vorher ohne diese Zeile neu anlegen
-- (gleicher Name ersetzt den Eintrag), dafür abgelaufene Eltern-Einladungen mit aufräumen
select cron.schedule('braincraft-aufraeumen', '17 3 * * *', $c$
  delete from braincraft.parent_sessions where expires_at < now();
  delete from braincraft.answers where answered_at < now() - interval '400 days';
  delete from braincraft.parent_invites where expires_at < now();
  delete from braincraft.pair_codes where expires_at < now() - interval '1 day';
  delete from braincraft.pair_attempts where at < now() - interval '1 day';
  delete from braincraft.devices where revoked_at < now() - interval '90 days';
$c$);

drop table if exists braincraft.invites;
alter table braincraft.families drop column if exists code_hash;

-- Kontrolle: keine Funktion mit p_code mehr, Konto-Funktionen nicht für anon
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and left(p.proname, 3) = 'bc_' and 'p_code' = any(p.proargnames)) then
    raise exception 'BrainCraft 008: noch Funktionen mit p_code vorhanden';
  end if;
  -- Konto-Funktionen nur mit Google-Sitzung (Kinder-Geräte rufen als anon mit Geräte-Token auf)
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('bc_session', 'bc_my_invites', 'bc_invite_accept', 'bc_invite_decline',
                                  'bc_family_create', 'bc_parents', 'bc_parent_invite', 'bc_parent_invite_delete',
                                  'bc_parent_remove', 'bc_pair_create', 'bc_devices', 'bc_device_revoke')
                and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'BrainCraft 008: anon darf Konto-Funktionen ausführen';
  end if;
end $$;
