-- =====================================================================
-- BrainCraft 006: Tests für bc_progress_reset (Daten-Dieter, 29.10.2026)
--
-- NUR ALS PROBELAUF, DER SICH SELBST ZURÜCKNIMMT (wie tests/005_tagesgrenze.sql):
--   Migration 006 (zweimal = Idempotenz) + diese Datei in EINEN äußeren DO-Block mit execute
--   packen und über die Supabase-CLI senden. Der letzte DO-Block wirft IMMER eine Exception mit
--   den Ergebnissen ("BRAINCRAFT-006 x/y bestanden"), dadurch wird alles zurückgerollt.
--   bc.desc = 1 gibt die Zeilen rückwärts aus, 2 von der Mitte aus (die CLI kürzt nach ~16 Zeilen).
--   Platzhalter __MD5__ ersetzt das Startskript durch den md5 des Funktionsrumpfs aus der Datei.
-- =====================================================================

create temp table bc_t (nr serial, name text, ok boolean, erw text, ist text);

create function pg_temp.chk(p_name text, p_erw text, p_ist text) returns void language sql as $$
  insert into bc_t (name, ok, erw, ist)
  values (p_name, p_erw is not distinct from p_ist, coalesce(p_erw, 'NULL'), coalesce(p_ist, 'NULL'));
$$;

create function pg_temp.fam(p_code text, p_pin text) returns uuid language sql as $$
  insert into braincraft.families (code_hash, pin_hash)
  values (encode(extensions.digest(braincraft.norm_code(p_code), 'sha256'), 'hex'),
          extensions.crypt(p_pin, extensions.gen_salt('bf', 4)))
  returning id;
$$;

create function pg_temp.tok(p_fam uuid) returns text language plpgsql as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into braincraft.parent_sessions (token_hash, family_id, expires_at)
  values (encode(extensions.digest(t, 'sha256'), 'hex'), p_fam, now() + interval '15 minutes');
  return t;
end $$;

create function pg_temp.kid(p_fam uuid, p_name text) returns uuid language sql as $$
  insert into braincraft.profiles (family_id, child_name) values (p_fam, p_name) returning id;
$$;

-- Ein Kind mit vollem Fortschritt: je 1 progress/answer/unit_view/inventory/boss_win, 2 Gutscheine
-- (offen + erledigt), Ledger 2 Zeilen (+30, -5), Stand 25. Dazu Klassenarbeit, Einheit, Frage, Belohnung.
create function pg_temp.fill(p_fam uuid, p_kid uuid, p_subj uuid) returns void language plpgsql as $$
declare e uuid; u uuid; q uuid; rw uuid; rd uuid := gen_random_uuid();
begin
  insert into braincraft.exams (family_id, profile_id, subject_id, title) values (p_fam, p_kid, p_subj, 'Testarbeit')
  returning id into e;
  insert into braincraft.learning_units (exam_id, summary_slides) values (e, '["Folie"]') returning id into u;
  insert into braincraft.questions (exam_id, unit_id, type, prompt, payload, status)
  values (e, u, 'multiple_choice', 'Testfrage ' || gen_random_uuid(),
          '{"options":["a","b","c","d"],"correct_index":0}', 'freigegeben') returning id into q;
  insert into braincraft.questions (exam_id, type, prompt, payload, status)
  values (e, 'multiple_choice', 'Entwurf ' || gen_random_uuid(), '{"options":["a","b","c","d"],"correct_index":0}', 'entwurf');
  insert into braincraft.progress (profile_id, question_id, leitner_box, consecutive_correct, correct_count,
                                   next_review_at, last_answered_at)
  values (p_kid, q, 3, 2, 2, now() + interval '3 days', now());
  insert into braincraft.answers (id, profile_id, question_id, correct, mode, answered_at)
  values (gen_random_uuid(), p_kid, q, true, 'solo', now());
  insert into braincraft.unit_views (profile_id, unit_id) values (p_kid, u);
  insert into braincraft.star_ledger (profile_id, delta, reason) values (p_kid, 30, 'answer');
  insert into braincraft.inventory (profile_id, item_key, exam_id) values (p_kid, 'helm', e);
  insert into braincraft.boss_wins (profile_id, exam_id, item_key) values (p_kid, e, 'helm');
  insert into braincraft.rewards (family_id, title, cost_stars) values (p_fam, 'Test-Belohnung', 5) returning id into rw;
  insert into braincraft.star_ledger (profile_id, delta, reason, ref_id) values (p_kid, -5, 'redeem', rd);
  insert into braincraft.redemptions (id, profile_id, reward_id, reward_title, cost_stars)
  values (rd, p_kid, rw, 'Test-Belohnung', 5);
  insert into braincraft.redemptions (id, profile_id, reward_id, reward_title, cost_stars, status, resolved_at)
  values (gen_random_uuid(), p_kid, rw, 'Test-Belohnung', 5, 'erledigt', now());
  update braincraft.profiles set stars_balance = 25 where id = p_kid;
end $$;

-- Stand eines Kindes: progress/answers/unit_views/ledger/inventory/boss_wins/redemptions/stars_balance
create function pg_temp.cnt(p_kid uuid) returns text language sql as $$
  select concat_ws('/',
    (select count(*) from braincraft.progress where profile_id = p_kid),
    (select count(*) from braincraft.answers where profile_id = p_kid),
    (select count(*) from braincraft.unit_views where profile_id = p_kid),
    (select count(*) from braincraft.star_ledger where profile_id = p_kid),
    (select count(*) from braincraft.inventory where profile_id = p_kid),
    (select count(*) from braincraft.boss_wins where profile_id = p_kid),
    (select count(*) from braincraft.redemptions where profile_id = p_kid),
    (select stars_balance from braincraft.profiles where id = p_kid));
$$;

-- Was bleiben muss: Kinder, Fächer, Arbeiten, Einheiten, Fragen (frei/Entwurf), Belohnungen,
-- Eltern-Sitzungen, PIN-Hash, Teile-Liste
create function pg_temp.keep(p_fam uuid) returns text language sql as $$
  select concat_ws('/',
    (select count(*) from braincraft.profiles where family_id = p_fam),
    (select count(*) from braincraft.subjects where family_id = p_fam),
    (select count(*) from braincraft.exams where family_id = p_fam),
    (select count(*) from braincraft.learning_units u join braincraft.exams e on e.id = u.exam_id where e.family_id = p_fam),
    (select count(*) filter (where q.status = 'freigegeben') || '+' || count(*) filter (where q.status = 'entwurf')
       from braincraft.questions q join braincraft.exams e on e.id = q.exam_id where e.family_id = p_fam),
    (select count(*) from braincraft.rewards where family_id = p_fam),
    (select count(*) from braincraft.parent_sessions where family_id = p_fam),
    (select md5(pin_hash) from braincraft.families where id = p_fam),
    (select count(*) from braincraft.items));
$$;

create function pg_temp.try(p_code text, p_token text, p_pin text, p_kid uuid) returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.bc_progress_reset(p_code, p_token, p_pin, p_kid);
  return coalesce(r->>'error', 'ok ' || (r->>'profiles'));
exception when others then return sqlerrm;
end $$;

do $$
declare
  ca text := 'BCTEST-0006-0000-0000-000A'; cb text := 'BCTEST-0006-0000-0000-000B';
  fa uuid; fb uuid; ta text; tb text; sa uuid; sb uuid; a1 uuid; a2 uuid; a3 uuid; b1 uuid;
  r jsonb; pull jsonb; s text; n_ok int; n_all int; i int; v_a2 text; v_b1 text; v_keep_a text; v_keep_b text;
  full_ text := '1/1/1/2/1/1/2/25'; zero text := '0/0/0/0/0/0/0/0';
begin
  -- Grundlage: Familie A mit drei Kindern, Familie B mit einem Kind, alle mit vollem Fortschritt
  fa := pg_temp.fam(ca, '1234'); ta := pg_temp.tok(fa);
  fb := pg_temp.fam(cb, '5678'); tb := pg_temp.tok(fb);
  insert into braincraft.subjects (family_id, name, icon, color_theme) values (fa, 'Testfach', 'book', 'bordeaux') returning id into sa;
  insert into braincraft.subjects (family_id, name, icon, color_theme) values (fb, 'Testfach', 'book', 'bordeaux') returning id into sb;
  a1 := pg_temp.kid(fa, 'Anna'); a2 := pg_temp.kid(fa, 'Ben'); a3 := pg_temp.kid(fa, 'Cleo'); b1 := pg_temp.kid(fb, 'Dora');
  perform pg_temp.fill(fa, a1, sa); perform pg_temp.fill(fa, a2, sa); perform pg_temp.fill(fa, a3, sa);
  perform pg_temp.fill(fb, b1, sb);
  v_keep_a := pg_temp.keep(fa); v_keep_b := pg_temp.keep(fb); v_b1 := pg_temp.cnt(b1);
  perform pg_temp.chk('S0 Ausgangsstand je Kind voll', full_ || '|' || full_, pg_temp.cnt(a1) || '|' || v_b1);

  -- ---------------- A: Rechte und Rumpf ----------------
  perform pg_temp.chk('A1 anon/authenticated dürfen bc_progress_reset', 'true/true',
    has_function_privilege('anon', 'public.bc_progress_reset(text,text,text,uuid)', 'execute')::text || '/' ||
    has_function_privilege('authenticated', 'public.bc_progress_reset(text,text,text,uuid)', 'execute')::text);
  perform pg_temp.chk('A2 anon ohne EXECUTE auf Helfer (pin_verify, parent, family, need_profile, is_parent, book)', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'braincraft' and p.proname in ('pin_verify', 'parent', 'family', 'need_profile', 'is_parent', 'book')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))));
  perform pg_temp.chk('A3 anon/authenticated ohne Rechte auf progress_resets, RLS an', 'false/false/false/true',
    has_table_privilege('anon', 'braincraft.progress_resets', 'select,insert,update,delete')::text || '/' ||
    has_table_privilege('authenticated', 'braincraft.progress_resets', 'select,insert,update,delete')::text || '/' ||
    has_schema_privilege('anon', 'braincraft', 'usage')::text || '/' ||
    (select relrowsecurity::text from pg_class where oid = 'braincraft.progress_resets'::regclass));
  perform pg_temp.chk('A4 bc_progress_reset: md5 = Datei 006, definer, search_path leer, 1 Fassung',
    '__MD5__/true/1',
    (select string_agg(md5(p.prosrc) || '/' || (p.prosecdef and p.proconfig = array['search_path=""'])::text, ',')
            || '/' || count(*)::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'bc_progress_reset'));
  -- echt als anon: Funktion aufrufbar (ohne Token -> pin_required), Tabelle gesperrt
  execute 'set local role anon';
  begin
    begin r := public.bc_progress_reset(ca, null, '1234', a1); s := 'ok';
    exception when others then s := sqlerrm; end;
    begin perform 1 from braincraft.progress_resets; s := s || '/lesbar';
    exception when others then s := s || '/' || sqlstate; end;
  exception when others then s := 'Fehler ' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.chk('A5 als anon: Aufruf ohne Token -> pin_required, Tabelle -> 42501', 'pin_required/42501', s);
  perform pg_temp.chk('A6 Rolle zurück auf postgres', 'postgres', current_user::text);

  -- ---------------- B: abgelehnt, nichts gelöscht ----------------
  perform pg_temp.chk('B1 ohne Token -> pin_required', 'pin_required', pg_temp.try(ca, null, '1234', a1));
  perform pg_temp.chk('B2 falsches Token -> pin_required', 'pin_required', pg_temp.try(ca, tb, '1234', a1));
  perform pg_temp.chk('B3 fremdes Kind (Familie B) -> profile_not_found', 'profile_not_found', pg_temp.try(ca, ta, '1234', b1));
  perform pg_temp.chk('B4 unbekannte Kind-ID -> profile_not_found', 'profile_not_found', pg_temp.try(ca, ta, '1234', gen_random_uuid()));
  r := public.bc_progress_reset(ca, ta, '0000', a1);
  perform pg_temp.chk('B5 falsche PIN -> {ok:false, pin_wrong}', 'false/pin_wrong', (r->>'ok') || '/' || (r->>'error'));
  perform pg_temp.chk('B6 falsche PIN zählt (pin_fails 1, ohne Rollback)', '1',
    (select pin_fails::text from braincraft.families where id = fa));
  -- Aufruf und Prüfwert in getrennten Anweisungen (gleicher Snapshot sähe die Änderung nicht)
  s := pg_temp.try(ca, ta, '12', a1);
  perform pg_temp.chk('B7 PIN mit falschem Format -> pin_wrong, pin_fails 2', 'pin_wrong/2',
    s || '/' || (select pin_fails::text from braincraft.families where id = fa));
  perform pg_temp.chk('B8 nach B1-B7 nichts gelöscht (a1, b1, Protokoll leer)', full_ || '|' || v_b1 || '|0',
    pg_temp.cnt(a1) || '|' || pg_temp.cnt(b1) || '|' ||
    (select count(*)::text from braincraft.progress_resets where family_id in (fa, fb)));

  -- ---------------- C: ein Kind ----------------
  v_a2 := pg_temp.cnt(a2);
  r := public.bc_progress_reset(ca, ta, '1234', a1);
  perform pg_temp.chk('C1 Rückgabe {ok:true, profiles:1, reset_at}', 'true/1/true',
    (r->>'ok') || '/' || (r->>'profiles') || '/' || (r ? 'reset_at')::text);
  perform pg_temp.chk('C2 a1: alle sieben Tabellen leer, Stand 0', zero, pg_temp.cnt(a1));
  perform pg_temp.chk('C3 Geschwister a2/a3 unberührt', v_a2 || '|' || full_, pg_temp.cnt(a2) || '|' || pg_temp.cnt(a3));
  perform pg_temp.chk('C4 Familie B unberührt', v_b1 || '|' || v_keep_b, pg_temp.cnt(b1) || '|' || pg_temp.keep(fb));
  perform pg_temp.chk('C5 bleibt: Kinder, Fächer, Arbeiten, Einheiten, Fragen inkl. Status, Belohnungen, Sitzung, PIN, Teile',
    v_keep_a, pg_temp.keep(fa));
  perform pg_temp.chk('C6 richtige PIN setzt Fehlzähler zurück', '0', (select pin_fails::text from braincraft.families where id = fa));
  perform pg_temp.chk('C7 Protokoll: 1 Eintrag, Kind a1, 1 Kind', '1/true/1',
    (select count(*)::text || '/' || bool_and(profile_id = a1)::text || '/' || max(profiles)::text
       from braincraft.progress_resets where family_id = fa));
  pull := public.bc_pull(ca, ta);
  perform pg_temp.chk('C8 bc_pull a1: stars_balance/stars_today/learn_days_week = 0/0/0', '0/0/0',
    (select concat_ws('/', x->>'stars_balance', x->>'stars_today', x->>'learn_days_week')
       from jsonb_array_elements(pull->'profiles') x where x->>'id' = a1::text));
  perform pg_temp.chk('C9 bc_pull a1 ohne progress/unit_views/inventory/boss_wins/redemptions', '0/0/0/0/0',
    concat_ws('/',
      (select count(*) from jsonb_array_elements(pull->'progress') x where x->>'profile_id' = a1::text),
      (select count(*) from jsonb_array_elements(pull->'unit_views') x where x->>'profile_id' = a1::text),
      (select count(*) from jsonb_array_elements(pull->'inventory') x where x->>'profile_id' = a1::text),
      (select count(*) from jsonb_array_elements(pull->'boss_wins') x where x->>'profile_id' = a1::text),
      (select count(*) from jsonb_array_elements(pull->'redemptions') x where x->>'profile_id' = a1::text)));
  perform pg_temp.chk('C10 bc_pull a2 hat weiter Stand 25 und je 1 progress/unit_view', '25/1/1',
    concat_ws('/',
      (select x->>'stars_balance' from jsonb_array_elements(pull->'profiles') x where x->>'id' = a2::text),
      (select count(*) from jsonb_array_elements(pull->'progress') x where x->>'profile_id' = a2::text),
      (select count(*) from jsonb_array_elements(pull->'unit_views') x where x->>'profile_id' = a2::text)));
  perform pg_temp.chk('C11 bc_pull: Fragen frei+Entwurf und Einheiten bleiben (3+3, 3)', '6/3',
    jsonb_array_length(pull->'questions')::text || '/' || jsonb_array_length(pull->'units')::text);
  -- danach normal weiterlernen: erste richtige Antwort bringt wieder 1 Stern
  r := public.bc_answer(ca, gen_random_uuid(), a1,
         (select q.id from braincraft.questions q join braincraft.exams e on e.id = q.exam_id
           where e.profile_id = a1 and q.status = 'freigegeben'), true, true, 'solo', null, null, 'test', null);
  perform pg_temp.chk('C12 nach dem Zurücksetzen: Antwort bucht 1 Stern, Leitner neu (Stufe 2)', '1/1/2',
    (r->>'stars_booked') || '/' || (r->>'stars_balance') || '/' || (r->>'leitner_box'));

  -- ---------------- D: Sperre, dann alle Kinder ----------------
  v_a2 := pg_temp.cnt(a2);
  perform pg_temp.try(ca, ta, '0000', null); perform pg_temp.try(ca, ta, '0000', null);
  r := public.bc_progress_reset(ca, ta, '0000', null);
  perform pg_temp.chk('D1 dritte falsche PIN -> pin_wrong mit Sperre', 'pin_wrong/true',
    (r->>'error') || '/' || (r->>'locked_until' is not null)::text);
  r := public.bc_progress_reset(ca, ta, '1234', null);
  perform pg_temp.chk('D2 gesperrt: auch richtige PIN -> pin_locked, nichts gelöscht', 'pin_locked/' || v_a2,
    (r->>'error') || '/' || pg_temp.cnt(a2));
  update braincraft.families set pin_fails = 0, pin_locked_until = null where id = fa;   -- Sperre für die Tests aufheben
  r := public.bc_progress_reset(ca, ta, '1234', null);
  perform pg_temp.chk('D3 null = alle Kinder -> profiles 3', 'true/3', (r->>'ok') || '/' || (r->>'profiles'));
  perform pg_temp.chk('D4 a1/a2/a3 alle leer', zero || '|' || zero || '|' || zero,
    pg_temp.cnt(a1) || '|' || pg_temp.cnt(a2) || '|' || pg_temp.cnt(a3));
  perform pg_temp.chk('D5 Familie B unberührt', v_b1 || '|' || v_keep_b, pg_temp.cnt(b1) || '|' || pg_temp.keep(fb));
  perform pg_temp.chk('D6 bleibt in Familie A (wie vorher)', v_keep_a, pg_temp.keep(fa));
  pull := public.bc_pull(ca, null);
  perform pg_temp.chk('D7 bc_pull A (Kind-Sicht): alle 0/0/0, keine progress/unit_views/inventory/boss_wins/redemptions',
    '0/0/0,0/0/0,0/0/0|0/0/0/0/0',
    (select string_agg(concat_ws('/', x->>'stars_balance', x->>'stars_today', x->>'learn_days_week'), ',')
       from jsonb_array_elements(pull->'profiles') x) || '|' ||
    concat_ws('/', jsonb_array_length(pull->'progress'), jsonb_array_length(pull->'unit_views'),
      jsonb_array_length(pull->'inventory'), jsonb_array_length(pull->'boss_wins'), jsonb_array_length(pull->'redemptions')));
  perform pg_temp.chk('D8 Protokoll: zweiter Eintrag mit profile_id null, 3 Kinder', 'null/3',
    (select coalesce(profile_id::text, 'null') || '/' || profiles from braincraft.progress_resets
      where family_id = fa order by id desc limit 1));

  -- ---------------- E: Bremse 5 je Familie in 24 h ----------------
  for i in 3..5 loop s := pg_temp.try(ca, ta, '1234', a1); end loop;
  perform pg_temp.chk('E1 Zurücksetzung 5 noch erlaubt', 'ok 1', s);
  perform pg_temp.chk('E2 sechste in 24 h -> limit_reached', 'limit_reached', pg_temp.try(ca, ta, '1234', null));
  s := pg_temp.try(ca, ta, '0000', null);
  perform pg_temp.chk('E3 limit_reached mit falscher PIN verbraucht keinen PIN-Versuch', 'limit_reached/0',
    s || '/' || (select pin_fails::text from braincraft.families where id = fa));
  perform pg_temp.chk('E4 Protokoll A: 5 Einträge (abgelehnte zählen nicht)', '5',
    (select count(*)::text from braincraft.progress_resets where family_id = fa));
  s := pg_temp.try(cb, tb, '5678', b1);
  perform pg_temp.chk('E5 Familie B hat eigene Bremse: Zurücksetzen geht, b1 leer', 'ok 1/' || zero,
    s || '/' || pg_temp.cnt(b1));
  update braincraft.progress_resets set created_at = now() - interval '25 hours' where family_id = fa;
  perform pg_temp.chk('E6 Einträge älter als 24 h zählen nicht mehr', 'ok 3', pg_temp.try(ca, ta, '1234', null));
  update braincraft.progress_resets set created_at = now() - interval '31 days'
   where id = (select min(id) from braincraft.progress_resets where family_id = fa);
  perform pg_temp.try(ca, ta, '1234', a3);
  perform pg_temp.chk('E7 Einträge älter als 30 Tage werden aufgeräumt (5 - 1 + 2 = 6)', '6',
    (select count(*)::text from braincraft.progress_resets where family_id = fa));
  delete from braincraft.profiles where id = a3;
  perform pg_temp.chk('E8 Kind a3 gelöscht -> Protokoll behält dessen Eintrag ohne Kind-Bezug', '6/0',
    (select count(*)::text || '/' || count(*) filter (where profile_id = a3)::text
       from braincraft.progress_resets where family_id = fa));

  -- ---------------- Ergebnis (wirft IMMER -> Rücknahme) ----------------
  select count(*) filter (where ok), count(*) into n_ok, n_all from bc_t;
  select string_agg(format('%s %s %s%s', case when ok then 'OK  ' else 'FEHL' end, nr, name,
                           case when ok then '' else format(' | erwartet %s | ist %s', erw, ist) end), E'\n'
                    order by case current_setting('bc.desc', true) when '1' then -nr when '2' then abs(nr - 22) else nr end)
    into s from bc_t;
  raise exception '%', format(E'BRAINCRAFT-006 %s/%s bestanden\n%s', n_ok, n_all, s);
end $$;
