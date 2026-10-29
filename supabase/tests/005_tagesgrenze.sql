-- =====================================================================
-- BrainCraft 005: Tests für Tagesgrenze 40, Boss nach dem Sieg, Teile-Liste (Daten-Dieter, 28.10.2026)
--
-- NUR ALS PROBELAUF, DER SICH SELBST ZURÜCKNIMMT (wie tests/001_logik.sql):
--   Migration 005 OHNE begin/commit (zweimal = Idempotenz) + diese Datei in EINEN äußeren DO-Block
--   mit execute packen und über die Supabase-CLI senden. Der letzte DO-Block wirft IMMER eine
--   Exception mit den Ergebnissen ("BRAINCRAFT-005 x/y bestanden"), dadurch wird alles zurückgerollt.
-- Alle Buchungen laufen mit now() = Beginn der Transaktion, also am heutigen Tag der Familie.
-- =====================================================================

create temp table bc_t (nr serial, name text, ok boolean, erw text, ist text);

create function pg_temp.chk(p_name text, p_erw text, p_ist text) returns void language sql as $$
  insert into bc_t (name, ok, erw, ist)
  values (p_name, p_erw is not distinct from p_ist, coalesce(p_erw, 'NULL'), coalesce(p_ist, 'NULL'));
$$;

create function pg_temp.kid(p_fam uuid, p_name text) returns uuid language sql as $$
  insert into braincraft.profiles (family_id, child_name) values (p_fam, p_name) returning id;
$$;

create function pg_temp.ex(p_fam uuid, p_kid uuid, p_subj uuid) returns uuid language sql as $$
  insert into braincraft.exams (family_id, profile_id, subject_id, title, exam_date)
  values (p_fam, p_kid, p_subj, 'Testarbeit', null) returning id;
$$;

-- freigegebene Frage; p_box <> null legt Lernstand an (Stufe 3 = zählt für die Boss-Freigabe)
create function pg_temp.q(p_exam uuid, p_kid uuid, p_box int default 3) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into braincraft.questions (exam_id, type, prompt, payload, status)
  values (p_exam, 'multiple_choice', 'Testfrage ' || gen_random_uuid(),
          '{"options":["a","b","c","d"],"correct_index":0}', 'freigegeben')
  returning id into v;
  if p_box is not null then
    insert into braincraft.progress (profile_id, question_id, leitner_box, consecutive_correct, next_review_at, last_answered_at)
    values (p_kid, v, p_box, 0, now() + interval '3 days', now() - interval '1 day');
  end if;
  return v;
end $$;

-- verdiente Sterne direkt ins Ledger (mit Stand)
create function pg_temp.earn(p_kid uuid, p_n int, p_at timestamptz) returns void language sql as $$
  insert into braincraft.star_ledger (profile_id, delta, reason, created_at) values (p_kid, p_n, 'answer', p_at);
  update braincraft.profiles set stars_balance = stars_balance + p_n where id = p_kid;
$$;

create function pg_temp.bal(p_kid uuid) returns text language sql as $$
  select stars_balance::text from braincraft.profiles where id = p_kid;
$$;

create function pg_temp.nled(p_kid uuid) returns text language sql as $$
  select count(*)::text || '/' || coalesce(sum(delta), 0)::text from braincraft.star_ledger where profile_id = p_kid;
$$;

do $$
declare
  c text := 'BCTEST-0005-0000-0000-0001'; fam uuid; tok text; subj uuid; r jsonb; pull jsonb; s text; n_ok int; n_all int;
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; k5 uuid; k6 uuid;
  e1 uuid; e2 uuid; e3 uuid; e5 uuid; e6 uuid; e6b uuid; q1 uuid; q2 uuid; q3 uuid; q5 uuid; v_led text; v_bal text;
  k7 uuid; q7 uuid; rd uuid; i int;
begin
  -- Grundlage
  insert into braincraft.families (code_hash, pin_hash)
  values (encode(extensions.digest(braincraft.norm_code(c), 'sha256'), 'hex'), extensions.crypt('1234', extensions.gen_salt('bf', 4)))
  returning id into fam;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into braincraft.parent_sessions (token_hash, family_id, expires_at)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), fam, now() + interval '15 minutes');
  insert into braincraft.subjects (family_id, name, icon, color_theme) values (fam, 'Testfach', 'book', 'bordeaux')
  returning id into subj;
  k1 := pg_temp.kid(fam, 'Grenze'); k2 := pg_temp.kid(fam, 'Boss'); k3 := pg_temp.kid(fam, 'Gestern');
  k4 := pg_temp.kid(fam, 'Ueber'); k5 := pg_temp.kid(fam, 'BossVoll'); k6 := pg_temp.kid(fam, 'Teile');

  -- ---------------- A: Konstante, Rechte, Rümpfe ----------------
  perform pg_temp.chk('A1 stars_daily_limit() = 40', '40', braincraft.stars_daily_limit()::text);
  perform pg_temp.chk('A2 anon darf stars_daily_limit nicht', 'false',
    has_function_privilege('anon', 'braincraft.stars_daily_limit()', 'execute')::text);
  perform pg_temp.chk('A3 anon darf book nicht', 'false',
    has_function_privilege('anon', 'braincraft.book(uuid,integer,text,uuid,text)', 'execute')::text);
  perform pg_temp.chk('A4 anon darf bc_answer', 'true',
    has_function_privilege('anon', 'public.bc_answer(text,uuid,uuid,uuid,boolean,boolean,text,timestamptz,text,text,uuid)', 'execute')::text);
  perform pg_temp.chk('A5 anon ohne USAGE auf Schema braincraft', 'false', has_schema_privilege('anon', 'braincraft', 'usage')::text);
  perform pg_temp.chk('A6 search_path leer + security definer (book, bc_answer, limit)', '3',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'braincraft' and p.proname in ('book', 'stars_daily_limit'))
          or (n.nspname = 'public' and p.proname = 'bc_answer'))
        and p.proconfig = array['search_path=""']
        and (p.prosecdef or p.proname = 'stars_daily_limit')));
  perform pg_temp.chk('A7 Rümpfe = Datei 005 (md5 book/bc_answer/limit)',
    'ddad81668d4d2ac8ec03eefacfa3ceec/368190c9e8fee2bd8a9ed5b546909b50/4d4c01e8144faf7b2825d3a51c93af43',
    (select string_agg(md5(p.prosrc), '/' order by case p.proname when 'book' then 1 when 'bc_answer' then 2 else 3 end)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'braincraft' and p.proname in ('book', 'stars_daily_limit'))
         or (n.nspname = 'public' and p.proname = 'bc_answer')));

  -- ---------------- B: Tagesgrenze 40 mit Kürzung ----------------
  e3 := pg_temp.ex(fam, k1, subj);
  perform pg_temp.earn(k1, 38, now());
  perform pg_temp.chk('B1 38 + 3 (Rundenbonus) -> +2', '2', braincraft.book(k1, 3, 'round', gen_random_uuid(), null)::text);
  perform pg_temp.chk('B2 Stand 40', '40', pg_temp.bal(k1));
  q3 := pg_temp.q(e3, k1, null);
  r := public.bc_answer(c, gen_random_uuid(), k1, q3, true, true, 'solo', null, null, 'test', null);
  perform pg_temp.chk('B3 Arena-Antwort bei 40 -> 0 Sterne', '0', r->>'stars_booked');
  r := public.bc_answer(c, gen_random_uuid(), k1, q3, true, true, 'eltern', null, tok, 'test', null);
  perform pg_temp.chk('B4 Gemeinsam-Abfragen bei 40 -> 0 Sterne, Antwort ok', 'true/0', (r->>'ok') || '/' || (r->>'stars_booked'));
  perform pg_temp.chk('B5 Rundenbonus bei 40 -> 0', '0', braincraft.book(k1, 3, 'round', gen_random_uuid(), null)::text);
  perform pg_temp.chk('B6 Ledger k1 unverändert (2 Zeilen, 40)', '2/40', pg_temp.nled(k1));
  pull := public.bc_pull(c, null);
  perform pg_temp.chk('B7 bc_pull stars_today k1 = 40', '40',
    (select x->>'stars_today' from jsonb_array_elements(pull->'profiles') x where x->>'id' = k1::text));
  perform pg_temp.chk('B8 Einlösen/Korrektur nicht begrenzt (book correction +5 bei 40)', '5',
    braincraft.book(k1, 5, 'correction', null, 'test')::text);

  -- gestern verdiente Sterne zählen nicht; Gemeinsam bucht 'parent_quiz' und zählt
  perform pg_temp.earn(k3, 40, now() - interval '1 day');
  r := public.bc_answer(c, gen_random_uuid(), k3, pg_temp.q(pg_temp.ex(fam, k3, subj), k3, null), true, false, 'eltern', null, tok, 'test', null);
  perform pg_temp.chk('B9 Gemeinsam: +1 auch ohne 1. Versuch, gestern zählt nicht', '1', r->>'stars_booked');
  perform pg_temp.chk('B10 Grund Gemeinsam = parent_quiz', 'parent_quiz',
    (select reason from braincraft.star_ledger where profile_id = k3 and created_at >= now() - interval '1 minute'));
  pull := public.bc_pull(c, null);
  perform pg_temp.chk('B11 bc_pull stars_today k3 = 1', '1',
    (select x->>'stars_today' from jsonb_array_elements(pull->'profiles') x where x->>'id' = k3::text));

  -- heute schon über 40 (vor dem Einspielen verdient): nichts mehr, aber kein Abzug
  perform pg_temp.earn(k4, 60, now());
  r := public.bc_answer(c, gen_random_uuid(), k4, pg_temp.q(pg_temp.ex(fam, k4, subj), k4, null), true, true, 'solo', null, null, 'test', null);
  perform pg_temp.chk('B12 schon 60 heute -> 0, Stand bleibt 60', '0/60', (r->>'stars_booked') || '/' || pg_temp.bal(k4));

  -- ---------------- C: Boss ----------------
  e1 := pg_temp.ex(fam, k2, subj); q1 := pg_temp.q(e1, k2, 3);
  e2 := pg_temp.ex(fam, k2, subj); q2 := pg_temp.q(e2, k2, 3);
  r := public.bc_answer(c, gen_random_uuid(), k2, q1, true, true, 'boss', null, null, 'test', gen_random_uuid());
  perform pg_temp.chk('C1 Boss-Antwort vor dem Sieg -> 1 Stern (Grund answer)', '1/answer',
    (r->>'stars_booked') || '/' || (select reason from braincraft.star_ledger where profile_id = k2 order by id desc limit 1));
  r := public.bc_boss_win(c, k2, e1);
  perform pg_temp.chk('C2 erster Sieg -> +10, Teil helm', '10/helm', (r->>'stars_booked') || '/' || (r->>'item_key'));
  v_led := pg_temp.nled(k2); v_bal := pg_temp.bal(k2);
  perform pg_temp.chk('C3 Stand nach Sieg 11', '11', v_bal);
  r := public.bc_answer(c, gen_random_uuid(), k2, q1, true, true, 'boss', null, null, 'test', gen_random_uuid());
  perform pg_temp.chk('C4 Boss-Antwort nach dem Sieg -> 0 Sterne, Antwort ok', 'true/0', (r->>'ok') || '/' || (r->>'stars_booked'));
  perform pg_temp.chk('C5 Boss-Antworten trotzdem protokolliert (2)', '2',
    (select count(*)::text from braincraft.answers where profile_id = k2 and mode = 'boss'));
  perform pg_temp.chk('C6 Ledger k2 nach Boss-Antwort unverändert', v_led, pg_temp.nled(k2));
  r := public.bc_boss_win(c, k2, e1);
  perform pg_temp.chk('C7 zweiter Sieg -> ok + duplicate, kein Teil, keine Sterne', 'true/true//',
    (r->>'ok') || '/' || (r->>'duplicate') || '/' || coalesce(r->>'item_key', '') || '/' || coalesce(r->>'stars_booked', ''));
  perform pg_temp.chk('C8 Ledger/Stand/Inventar nach zweitem Sieg unverändert', v_led || '|' || v_bal || '|1',
    pg_temp.nled(k2) || '|' || pg_temp.bal(k2) || '|' ||
    (select count(*)::text from braincraft.inventory where profile_id = k2));
  r := public.bc_answer(c, gen_random_uuid(), k2, q1, true, true, 'solo', null, null, 'test', null);
  perform pg_temp.chk('C9 Arena-Antwort derselben Arbeit nach Sieg -> 1 (nur Boss gesperrt)', '1', r->>'stars_booked');
  r := public.bc_answer(c, gen_random_uuid(), k2, q2, true, true, 'boss', null, null, 'test', gen_random_uuid());
  perform pg_temp.chk('C10 Boss-Antwort andere Arbeit (nicht besiegt) -> 1', '1', r->>'stars_booked');
  r := public.bc_answer(c, gen_random_uuid(), k2, q1, true, false, 'boss', null, null, 'test', gen_random_uuid());
  perform pg_temp.chk('C11 Boss-Antwort nicht im 1. Versuch -> 0', '0', r->>'stars_booked');

  -- Boss-Bonus ist von der Tagesgrenze ausgenommen
  perform pg_temp.earn(k5, 40, now());
  e5 := pg_temp.ex(fam, k5, subj); q5 := pg_temp.q(e5, k5, 3);
  r := public.bc_answer(c, gen_random_uuid(), k5, q5, true, true, 'boss', null, null, 'test', gen_random_uuid());
  perform pg_temp.chk('C12 Boss-Antwort bei 40 -> 0 (zählt zur Grenze)', '0', r->>'stars_booked');
  r := public.bc_boss_win(c, k5, e5);
  perform pg_temp.chk('C13 Sieg bei 40 -> +10 trotzdem, Stand 50', '10/50', (r->>'stars_booked') || '/' || pg_temp.bal(k5));
  pull := public.bc_pull(c, null);
  perform pg_temp.chk('C14 stars_today k5 bleibt 40 (Boss-Bonus zählt nicht)', '40',
    (select x->>'stars_today' from jsonb_array_elements(pull->'profiles') x where x->>'id' = k5::text));

  -- ---------------- D: Teile-Liste und Vergabe-Reihenfolge ----------------
  perform pg_temp.chk('D1 12 Teile in neuer Reihenfolge',
    'helm,handschuhe,stiefel,guertel,schild,umhang,fernglas,kompass,abzeichen,fluegel,pokal,krone',
    (select string_agg(item_key, ',' order by sort) from braincraft.items));
  perform pg_temp.chk('D2 sort lückenlos 1..12', '1-12-12',
    (select min(sort) || '-' || max(sort) || '-' || count(distinct sort) from braincraft.items));
  perform pg_temp.chk('D3 Namen DE', 'Pilotenhelm,Rennhandschuhe,Turbo-Stiefel,Werkzeuggürtel,Blockschild,Windumhang,'
    || 'Adler-Fernglas,Sternenkompass,Rennabzeichen,Düsenflügel,Siegerpokal,Sternenkrone',
    (select string_agg(title_de, ',' order by sort) from braincraft.items));
  perform pg_temp.chk('D4 Namen EN', 'Pilot helmet,Racing gloves,Turbo boots,Tool belt,Block shield,Wind cape,'
    || 'Eagle binoculars,Star compass,Racing badge,Jet wings,Winner''s trophy,Star crown',
    (select string_agg(title_en, ',' order by sort) from braincraft.items));
  perform pg_temp.chk('D5 erster Sieg vergibt Pilotenhelm', 'helm/Pilotenhelm',
    (select i.item_key || '/' || it.title_de from braincraft.inventory i join braincraft.items it using (item_key)
      where i.profile_id = k5));
  -- k6 hat schon die ersten drei Teile: nächste Siege -> Werkzeuggürtel, dann Blockschild
  insert into braincraft.inventory (profile_id, item_key) values (k6, 'helm'), (k6, 'handschuhe'), (k6, 'stiefel');
  e6 := pg_temp.ex(fam, k6, subj); perform pg_temp.q(e6, k6, 3);
  e6b := pg_temp.ex(fam, k6, subj); perform pg_temp.q(e6b, k6, 3);
  r := public.bc_boss_win(c, k6, e6);
  s := r->>'item_key';
  r := public.bc_boss_win(c, k6, e6b);
  perform pg_temp.chk('D6 Werkzeuggürtel vor Blockschild', 'guertel,schild', s || ',' || (r->>'item_key'));

  -- ---------------- R: Rundenbonus nur für Arena-Runden (Siggi a) ----------------
  k7 := pg_temp.kid(fam, 'Runde'); q7 := pg_temp.q(pg_temp.ex(fam, k7, subj), k7, null);
  -- R1: 5 Boss-Antworten
  rd := gen_random_uuid();
  for i in 1..5 loop perform public.bc_answer(c, gen_random_uuid(), k7, q7, true, true, 'boss', null, null, 'test', rd); end loop;
  begin r := public.bc_round_finish(c, rd, k7); s := 'ok ' || (r->>'stars_booked'); exception when others then s := sqlerrm; end;
  perform pg_temp.chk('R1 5 Boss-Antworten -> round_too_short', 'round_too_short', s);
  -- R2: 5 Gemeinsam-Antworten
  rd := gen_random_uuid();
  for i in 1..5 loop perform public.bc_answer(c, gen_random_uuid(), k7, q7, true, true, 'eltern', null, tok, 'test', rd); end loop;
  begin r := public.bc_round_finish(c, rd, k7); s := 'ok ' || (r->>'stars_booked'); exception when others then s := sqlerrm; end;
  perform pg_temp.chk('R2 5 Gemeinsam-Antworten -> round_too_short', 'round_too_short', s);
  -- R3: 4 Solo + 1 Boss
  rd := gen_random_uuid();
  for i in 1..4 loop perform public.bc_answer(c, gen_random_uuid(), k7, q7, false, true, 'solo', null, null, 'test', rd); end loop;
  perform public.bc_answer(c, gen_random_uuid(), k7, q7, false, true, 'boss', null, null, 'test', rd);
  begin r := public.bc_round_finish(c, rd, k7); s := 'ok ' || (r->>'stars_booked'); exception when others then s := sqlerrm; end;
  perform pg_temp.chk('R3 4 Solo + 1 Boss -> round_too_short', 'round_too_short', s);
  -- R4: 3 Solo + 2 Chill (falsch beantwortet, damit k7 weit unter der Grenze bleibt)
  rd := gen_random_uuid();
  for i in 1..3 loop perform public.bc_answer(c, gen_random_uuid(), k7, q7, false, true, 'solo', null, null, 'test', rd); end loop;
  for i in 1..2 loop perform public.bc_answer(c, gen_random_uuid(), k7, q7, false, true, 'chill', null, null, 'test', rd); end loop;
  begin r := public.bc_round_finish(c, rd, k7); s := 'ok ' || (r->>'stars_booked'); exception when others then s := sqlerrm; end;
  perform pg_temp.chk('R4 3 Solo + 2 Chill -> +3', 'ok 3', s);
  perform pg_temp.chk('R5 bc_round_finish: md5 = Datei 005, anon EXECUTE, search_path leer, definer',
    '937f6a92098f1fe83ea753fcb01f7cb1/true/true',
    (select md5(p.prosrc) || '/' || has_function_privilege('anon', p.oid, 'execute')::text || '/'
            || (p.prosecdef and p.proconfig = array['search_path=""'])::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'bc_round_finish'));

  -- ---------------- Ergebnis (wirft IMMER -> Rücknahme) ----------------
  select count(*) filter (where ok), count(*) into n_ok, n_all from bc_t;
  select string_agg(format('%s %s %s%s', case when ok then 'OK  ' else 'FEHL' end, nr, name,
                           case when ok then '' else format(' | erwartet %s | ist %s', erw, ist) end), E'\n' order by nr)
    into s from bc_t;
  raise exception '%', format(E'BRAINCRAFT-005 %s/%s bestanden\n%s', n_ok, n_all, s);
end $$;
