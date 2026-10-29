-- =====================================================================
-- BrainCraft 003: Doppelte Fragen an Typ + Text + Inhalt erkennen
-- Entwurf von Daten-Dieter, Stand 25.10.2026 (docs/entscheidungen.md, 25.10.2026
-- „gefundener Mangel“). Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. Setzt 001 und 002
-- voraus. NOCH NICHT EINGESPIELT.
--
--  * bc_unit_import erkannte Doppelungen nur an Typ + lower(btrim(prompt)). Allgemeine
--    Fragetexte („Setze das passende Wort ein:“) kommen bei vielen verschiedenen Fragen vor
--    und wurden fälschlich übersprungen.
--  * Neu: doppelt nur bei gleichem Typ, gleichem Text (lower/btrim) UND gleichem payload.
--    payload wird als jsonb verglichen (= und DISTINCT ON): unabhängig von Schlüssel-
--    Reihenfolge und Leerzeichen, Reihenfolge in Arrays zählt (andere Frage).
--    Gilt an beiden Stellen: Zählen der neuen Fragen und INSERT ... DISTINCT ON ... NOT EXISTS.
--  * Sonst unverändert: Signatur, SECURITY DEFINER, search_path '', Grenzen (80 Fragen je
--    Import, 1000 Lerneinheiten, 3000/300 Fragen), Fehlercodes, Status 'entwurf',
--    "nur Duplikate -> keine Lerneinheit".
--  * Gleicher Maßstab wie validate.ts der Edge Function bc-extract (Typ + Text + Inhalt).
--  * Ändert KEINE Zeilen: nur CREATE OR REPLACE FUNCTION und Rechte.
-- Idempotent: CREATE OR REPLACE, Rechte-Schleife wie in 001/002 (Siggi N5).
-- =====================================================================

begin;

-- Analyse-Ergebnis übernehmen (Eltern), alles oder nichts. Fragen kommen als 'entwurf'.
-- p_questions: [{type, prompt, payload}, ...]. Gleiche Frage (Typ + Text + payload) wird
-- übersprungen; enthält der Import nur Duplikate, entsteht keine Lerneinheit (Siggi H1).
create or replace function public.bc_unit_import(p_code text, p_token text, p_exam_id uuid, p_scan_job_id uuid,
                                                 p_slides jsonb, p_questions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v_unit uuid; q record; v_new integer;
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

  -- neue (nicht doppelte) Fragen zählen: Typ + Text + payload (jsonb-Gleichheit)
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

  insert into braincraft.questions (exam_id, unit_id, type, prompt, payload, status)
  select distinct on (lower(btrim(x->>'prompt')), x->>'type', x->'payload')
         p_exam_id, v_unit, (x->>'type')::braincraft.question_type, btrim(x->>'prompt'), x->'payload', 'entwurf'
    from jsonb_array_elements(p_questions) x
   where not exists (select 1 from braincraft.questions o
                      where o.exam_id = p_exam_id and o.is_active
                        and o.type = (x->>'type')::braincraft.question_type
                        and lower(o.prompt) = lower(btrim(x->>'prompt'))
                        and o.payload = x->'payload');
  get diagnostics v_new = row_count;
  return jsonb_build_object('unit_id', v_unit, 'inserted', v_new);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- Rechte: wie 002 (Siggi N5)
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
