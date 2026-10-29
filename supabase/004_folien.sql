-- =====================================================================
-- BrainCraft 004: Folien gesehen je Kind und Folienverweis je Frage
-- Entwurf von Daten-Dieter, Stand 25.10.2026 (Anlass: Lern-Lottes Prüfung des Wissens-Hubs).
-- Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. Setzt 001, 002 UND 003 voraus
-- (bc_unit_import baut auf der Duplikatregel aus 003 auf). NOCH NICHT EINGESPIELT.
--
--  * Neue Tabelle braincraft.unit_views (profile_id, unit_id, seen_at), PK (profile_id, unit_id).
--    FKs mit on delete cascade; Familien-Konsistenz wie progress/boss_wins über die Funktion.
--    RLS an, keine Policies, keine Tabellenrechte für anon/authenticated.
--  * Neue Funktion public.bc_unit_seen(p_code, p_profile_id, p_unit_id) für anon:
--    idempotent (zweiter Aufruf behält das erste seen_at), prüft Profil und Einheit gegen die
--    Familie des Codes, höchstens 1000 Einträge je Kind.
--  * Neue Spalte braincraft.questions.slide_index smallint null, check 0..7.
--    Vorhandene Fragen bleiben null (keine Datenänderung, kein Tabellen-Umschreiben).
--  * bc_unit_import (Stand 003) übernimmt q.slide: nur eine ganze JSON-Zahl im Bereich
--    0..jsonb_array_length(p_slides)-1, sonst null (kein Fehler). slide zählt nicht zum Duplikat
--    (Regel aus 003: Typ + Text + payload). Bei Duplikaten innerhalb eines Imports gewinnt das
--    erste Vorkommen (vorher zufällig).
--  * bc_pull liefert zusätzlich questions[].slide_index und unit_views[] der Familie.
--  * bc_question_save unverändert.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, Rechte-Schleife wie 001-003 (Siggi N5).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Tabelle und Spalte
-- ---------------------------------------------------------------------

-- Folien einer Lerneinheit gesehen (pro Kind höchstens ein Eintrag je Einheit)
create table if not exists braincraft.unit_views (
  profile_id uuid not null references braincraft.profiles(id) on delete cascade,
  unit_id    uuid not null references braincraft.learning_units(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (profile_id, unit_id)
);
create index if not exists unit_views_unit_idx on braincraft.unit_views (unit_id);
alter table braincraft.unit_views enable row level security;

-- Folie (0-basiert) in summary_slides der Lerneinheit, auf die sich die Frage bezieht
alter table braincraft.questions add column if not exists slide_index smallint
  constraint questions_slide_index_check check (slide_index between 0 and 7);

-- ---------------------------------------------------------------------
-- Folien gesehen (Kind, ohne Eltern-Token)
-- ---------------------------------------------------------------------
create or replace function public.bc_unit_seen(p_code text, p_profile_id uuid, p_unit_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); v_seen timestamptz;
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
end $$;

-- ---------------------------------------------------------------------
-- Gesamter Stand der Familie (wie 001, plus questions[].slide_index und unit_views)
-- Ohne Eltern-Token nur freigegebene Fragen; mit Token auch Entwürfe und Scan-Aufträge.
-- "Lerntage diese Woche" = verschiedene Kalendertage mit Antworten seit Montag (Zeitzone der Familie).
-- ---------------------------------------------------------------------
create or replace function public.bc_pull(p_code text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); tz text; v_parent boolean; v_today date; v_week_start timestamptz;
begin
  select timezone into tz from braincraft.families where id = f;
  v_parent := braincraft.is_parent(f, p_token);
  v_today := (now() at time zone tz)::date;
  v_week_start := (date_trunc('week', v_today::timestamp))::timestamp at time zone tz;
  return jsonb_build_object(
    'server_time', now(),
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
end $$;

-- ---------------------------------------------------------------------
-- Analyse-Ergebnis übernehmen (Eltern), alles oder nichts. Fragen kommen als 'entwurf'.
-- p_questions: [{type, prompt, payload, slide?}, ...]. Gleiche Frage (Typ + Text + payload, Regel
-- aus 003) wird übersprungen; slide zählt nicht dazu. Enthält der Import nur Duplikate, entsteht
-- keine Lerneinheit (Siggi H1). slide: ganze Zahl 0..Folienzahl-1, sonst null (kein Fehler).
-- ---------------------------------------------------------------------
create or replace function public.bc_unit_import(p_code text, p_token text, p_exam_id uuid, p_scan_job_id uuid,
                                                 p_slides jsonb, p_questions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v_unit uuid; q record; v_new integer; v_nslides integer;
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
end $$;

-- ---------------------------------------------------------------------
-- Rechte: wie 002/003 (Siggi N5). bc_unit_seen fällt in den else-Zweig (anon, authenticated).
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

commit;
