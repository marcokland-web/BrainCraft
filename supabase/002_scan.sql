-- =====================================================================
-- BrainCraft 002: Scan-Absicherung für die Edge Function bc-extract
-- Entwurf von Daten-Dieter, Stand 23.10.2026 (Befunde Sicherheits-Siggi zur Edge Function).
-- Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. Setzt 001_braincraft.sql voraus und
-- ergänzt nur. NOCH NICHT EINGESPIELT.
--
--  * bc_scan_check   (anon): Auftrag gehört zur Familie? Eltern-Token gültig? Status.
--                     Ersetzt den teuren bc_pull in der Edge Function.
--  * bc_scan_tick    (service_role): zählt KI-Aufrufe je Auftrag und begrenzt sie:
--                     analyze <= 2 x image_count und merge <= 2 je Auftrag,
--                     analyze <= 60 je Familie in 24 h, analyze <= 300 und merge <= 40
--                     für alle Familien zusammen in 24 h. Geschlossene Aufträge -> scan_closed.
--                     Erste analyze-Zählung setzt 'hochladen' -> 'analyse'.
--  * bc_scan_orphans (service_role): Storage-Objekte im Bucket bc-scans ohne offenen Auftrag
--                     (älter als 1 h, höchstens 500), auch ungültige Pfade.
--  * bc_cron_secret  (service_role): liest das Vault-Secret braincraft_cron_secret.
--  * Vault-Secret braincraft_cron_secret wird zufällig erzeugt, falls es fehlt (nie im Klartext hier).
--  * pg_cron braincraft-fotos alle 15 Minuten: ruft bc-extract mit Header x-cron-secret auf
--    (Wert erst zur Laufzeit aus dem Vault, wie rechenstern-reminders).
--  * Bucket bc-scans nimmt nur noch image/jpeg an.
-- Zählweise "24 h": Summe der Zähler aller Aufträge, die in den letzten 24 h angelegt wurden
--  (ein Auftrag ist höchstens 2 h offen, Ticket-Laufzeit). Abgelehnte Aufrufe zählen nicht.
--  Alle Zählungen laufen nacheinander (Transaktions-Sperre), damit parallele Aufrufe die
--  Familien- und Gesamtgrenzen nicht überholen.
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, Secret nur wenn fehlend,
--  cron.schedule mit festem Namen, Bucket per UPDATE.
-- Rechte-Schleife wie in 001 (Siggi N5), um die neuen Server-Funktionen ergänzt.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Zähler je Auftrag
-- ---------------------------------------------------------------------
alter table braincraft.scan_jobs add column if not exists analyze_calls integer not null default 0 check (analyze_calls >= 0);
alter table braincraft.scan_jobs add column if not exists merge_calls   integer not null default 0 check (merge_calls >= 0);
-- Für die Gesamtgrenze über alle Familien (scan_jobs_open_idx ist nur ein Teilindex).
create index if not exists scan_jobs_created_idx on braincraft.scan_jobs (created_at);

-- ---------------------------------------------------------------------
-- Öffentliche Funktionen
-- ---------------------------------------------------------------------

-- Für die Edge Function mit dem Code der Familie (auch anon): gehört der Auftrag zur Familie,
-- ist das Eltern-Token gültig (Token darf null sein)? Ohne gültigen Code: not_found.
-- found = false verrät nicht, ob es den Auftrag in einer anderen Familie gibt.
create or replace function public.bc_scan_check(p_code text, p_token text, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); r record;
begin
  select j.status, j.images_deleted_at into r
    from braincraft.scan_jobs j where j.id = p_job_id and j.family_id = f;
  return jsonb_build_object(
    'found', r.status is not null,
    'parent', braincraft.is_parent(f, p_token),
    'status', r.status,
    'images_deleted', case when r.status is not null then r.images_deleted_at is not null end);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Nur Server: einen KI-Aufruf zählen (p_kind 'analyze' oder 'merge') und Grenzen durchsetzen.
create or replace function public.bc_scan_tick(p_job_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare j record; v_fam integer; v_all integer;
begin
  perform braincraft.nur_server();
  if p_kind is null or p_kind not in ('analyze', 'merge') then raise exception 'bad_kind'; end if;
  -- alle Zählungen nacheinander (Familien- und Gesamtgrenze sonst bei parallelen Aufrufen überholbar)
  perform pg_advisory_xact_lock(hashtextextended('braincraft.scan_tick', 0));
  select s.family_id, s.image_count, s.status, s.images_deleted_at, s.analyze_calls, s.merge_calls into j
    from braincraft.scan_jobs s where s.id = p_job_id for update;
  if j.family_id is null then raise exception 'scan_not_found'; end if;
  if j.status in ('fertig', 'fehler') or j.images_deleted_at is not null then raise exception 'scan_closed'; end if;

  if p_kind = 'analyze' then
    if j.analyze_calls + 1 > 2 * j.image_count then raise exception 'limit_reached'; end if;
    select coalesce(sum(s.analyze_calls), 0) into v_fam from braincraft.scan_jobs s
     where s.family_id = j.family_id and s.created_at > now() - interval '24 hours';
    if v_fam + 1 > 60 then raise exception 'limit_reached'; end if;
    select coalesce(sum(s.analyze_calls), 0) into v_all from braincraft.scan_jobs s
     where s.created_at > now() - interval '24 hours';
    if v_all + 1 > 300 then raise exception 'limit_reached'; end if;
    update braincraft.scan_jobs
       set analyze_calls = analyze_calls + 1,
           status = case when status = 'hochladen' then 'analyse' else status end
     where id = p_job_id;
  else
    if j.merge_calls + 1 > 2 then raise exception 'limit_reached'; end if;
    select coalesce(sum(s.merge_calls), 0) into v_all from braincraft.scan_jobs s
     where s.created_at > now() - interval '24 hours';
    if v_all + 1 > 40 then raise exception 'limit_reached'; end if;
    update braincraft.scan_jobs set merge_calls = merge_calls + 1 where id = p_job_id;
  end if;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Nur Server: Fotos im Bucket bc-scans, die älter als 1 h sind und zu keinem offenen Auftrag
-- gehören (Auftrag fehlt, Fotos als gelöscht gemeldet, Pfad ungültig). Gültig ist nur
-- "<family_id>/<job_id>/<i>.jpg" mit i < image_count; gecastet wird erst nach Mustertest.
create or replace function public.bc_scan_orphans()
returns table (name text) language plpgsql stable security definer set search_path = '' as $$
begin
  perform braincraft.nur_server();
  return query
    select o.name
      from storage.objects o
     where o.bucket_id = 'bc-scans'
       and o.created_at < now() - interval '1 hour'
       and not exists (
         select 1 from braincraft.scan_jobs j
          where o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]\.jpg$'
            and j.family_id = (case when o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                                    then split_part(o.name, '/', 1)::uuid end)
            and j.id = (case when o.name ~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                             then split_part(o.name, '/', 2)::uuid end)
            and (case when o.name ~ '/[0-9]\.jpg$' then left(split_part(o.name, '/', 3), 1)::int end) < j.image_count
            and j.images_deleted_at is null)
     order by o.created_at
     limit 500;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Nur Server: Secret für den Zeitplan-Aufruf (die Edge Function vergleicht damit x-cron-secret).
create or replace function public.bc_cron_secret()
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  perform braincraft.nur_server();
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'braincraft_cron_secret');
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- Vault-Secret (zufällig, nur anlegen, wenn es fehlt; nie im Klartext in dieser Datei)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'braincraft_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'braincraft_cron_secret',
                                'BrainCraft: x-cron-secret für bc-extract (pg_cron braincraft-fotos)');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Rechte: wie 001, Server-Funktionen erweitert (Siggi N5)
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

-- ---------------------------------------------------------------------
-- Storage: nur noch JPEG (die Edge Function erzeugt Upload-URLs nur für "<i>.jpg")
-- ---------------------------------------------------------------------
update storage.buckets set allowed_mime_types = array['image/jpeg'] where id = 'bc-scans';

-- ---------------------------------------------------------------------
-- Zeitplan: alle 15 Minuten liegengebliebene Fotos aufräumen lassen (Edge Function bc-extract,
-- Zweig "cleanup"). Secret wird erst beim Lauf aus dem Vault gelesen.
-- ---------------------------------------------------------------------
select cron.schedule('braincraft-fotos', '*/15 * * * *', $c$
  select net.http_post(
    url := 'https://asfwbuptsfcrgmmgdgim.supabase.co/functions/v1/bc-extract',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'braincraft_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$c$);

commit;
