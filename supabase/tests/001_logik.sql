-- =====================================================================
-- BrainCraft 001: Logik-Tests (Bug-Bodo, 23.10.2026)
-- Prüft Leitner, Sterne, Einlösen, Boss-Freigabe, Antworten und den
-- pg_cron-Aufräumjob aus supabase/001_braincraft.sql (Fassung mit Einladungscodes,
-- round_id, boss_wins/items, err_code und deutschen Gutschein-Status).
--
-- NUR ALS PROBELAUF, DER SICH SELBST ZURÜCKNIMMT:
--   Migration OHNE ihr begin/commit + diese Datei als EINE Anfrage senden.
--   Der letzte DO-Block wirft IMMER eine Exception mit den Ergebnissen,
--   dadurch wird alles (Schema, Funktionen, Bucket, Cron-Job) zurückgerollt.
--
--   { sed '/^begin;$/d; /^commit;$/d' supabase/001_braincraft.sql; cat supabase/tests/001_logik.sql; } > probelauf.sql
--   Sicherster Weg: alles in EINEN DO-Block packen (eine einzige Anweisung, also atomar,
--   egal wie das Werkzeug Anweisungen trennt) und mit der Supabase-CLI senden:
--     do-Block mit Dollar-Quote (eigene Marke, die im Text nicht vorkommt) und darin execute <Inhalt>
--     npx supabase db query --linked --project-ref <ref> -f lauf.sql
--   NIEMALS psql -f probelauf.sql ohne diese Hülle: dort wird jede Anweisung einzeln festgeschrieben.
--   Supabase-MCP (execute_sql) nimmt nur rund 50 KB je Anfrage an und reicht dafür nicht.
--
-- Ergebnis steht in der Fehlermeldung: "BRAINCRAFT-TEST x/y bestanden" und je Zeile OK/FEHL.
-- Danach prüfen, dass nichts geblieben ist (Schema braincraft, public.bc_*, Bucket bc-scans,
-- cron.job 'braincraft-aufraeumen').
--
-- Zeitbezug: Grundtag D = 23.10.2026 (Antworten um 10:00 Berlin), solange der Lauf
-- zwischen 23.10.2026 10:00 und 19.11.2026 stattfindet (Antworten dürfen höchstens 30 Tage
-- alt sein). Dann laufen auch die festen Prüfungen zur Zeitumstellung am 25.10.2026.
-- Sonst ist D = heute, die Zeitumstellungs-Prüfungen werden als übersprungen gemeldet.
-- Familie, Eltern-Sitzung und Fach legt der Test direkt an (Einladung/PIN sind nicht Teil
-- dieser Logik-Prüfung).
-- =====================================================================

select set_config('timezone', 'UTC', true);

create temp table bc_t (nr serial, name text, ok boolean, erw text, ist text);
create temp table bc_ctx (c text, fam uuid, k0 uuid, tok text, subj uuid, d0 date, dd date, t timestamptz, dst boolean);

-- ---------------------------------------------------------------------
-- Helfer (nur in pg_temp, verschwinden mit der Transaktion)
-- ---------------------------------------------------------------------
create function pg_temp.chk(p_name text, p_erw text, p_ist text) returns void language sql as $$
  insert into bc_t (name, ok, erw, ist)
  values (p_name, p_erw is not distinct from p_ist, coalesce(p_erw, 'NULL'), coalesce(p_ist, 'NULL'));
$$;

create function pg_temp.ts(x timestamptz) returns text language sql as $$
  select to_char(x at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || 'Z';
$$;

-- Ortszeit Berlin -> timestamptz
create function pg_temp.lt(d date, t time default '00:00') returns timestamptz language sql as $$
  select (d + t) at time zone 'Europe/Berlin';
$$;

-- führt SQL aus, liefert 'ok' oder den Fehlertext (Wirkung eines Fehlers wird zurückgerollt)
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.q(p_exam uuid, p_status text default 'freigegeben') returns uuid language sql as $$
  insert into braincraft.questions (exam_id, type, prompt, payload, status)
  values (p_exam, 'multiple_choice', 'Testfrage ' || gen_random_uuid(),
          '{"options":["a","b","c","d"],"correct_index":0}', p_status)
  returning id;
$$;

create function pg_temp.kid(p_fam uuid, p_name text) returns uuid language sql as $$
  insert into braincraft.profiles (family_id, child_name) values (p_fam, p_name) returning id;
$$;

create function pg_temp.ex(p_fam uuid, p_kid uuid, p_subj uuid, p_date date) returns uuid language sql as $$
  insert into braincraft.exams (family_id, profile_id, subject_id, title, exam_date)
  values (p_fam, p_kid, p_subj, 'Testarbeit', p_date) returning id;
$$;

create function pg_temp.prog(p_kid uuid, p_q uuid, p_box int, p_next timestamptz, p_last timestamptz, p_cc int default 0)
returns void language sql as $$
  insert into braincraft.progress (profile_id, question_id, leitner_box, consecutive_correct, next_review_at, last_answered_at)
  values (p_kid, p_q, p_box, p_cc, p_next, p_last);
$$;

create function pg_temp.ans(p_code text, p_kid uuid, p_q uuid, p_correct boolean, p_at timestamptz default null,
                            p_first boolean default true, p_mode text default 'solo', p_tok text default null,
                            p_id uuid default null, p_round uuid default null)
returns jsonb language sql as $$
  select public.bc_answer(p_code, coalesce(p_id, gen_random_uuid()), p_kid, p_q, p_correct, p_first, p_mode, p_at,
                          p_tok, 'test', p_round);
$$;

-- verdiente Sterne direkt ins Ledger (mit Stand), z. B. um die Tagesgrenze vorzubereiten
create function pg_temp.earn(p_kid uuid, p_n int, p_at timestamptz) returns void language sql as $$
  insert into braincraft.star_ledger (profile_id, delta, reason, created_at) values (p_kid, p_n, 'answer', p_at);
  update braincraft.profiles set stars_balance = stars_balance + p_n where id = p_kid;
$$;

create function pg_temp.box(p_kid uuid, p_q uuid) returns text language sql as $$
  select leitner_box || ' / ' || pg_temp.ts(next_review_at) from braincraft.progress
   where profile_id = p_kid and question_id = p_q;
$$;

create function pg_temp.bal(p_kid uuid) returns text language sql as $$
  select stars_balance::text from braincraft.profiles where id = p_kid;
$$;

-- eine Leitner-Antwort auf eine frische Frage einer eigenen Arbeit (Datum p_date),
-- Ausgangsstufe p_box (null = neue Frage), fällig seit 1 Stunde
create function pg_temp.lauf(p_code text, p_fam uuid, p_kid uuid, p_subj uuid, p_date date, p_box int,
                             p_correct boolean, p_at timestamptz, p_mode text default 'solo') returns text language plpgsql as $$
declare e uuid := pg_temp.ex(p_fam, p_kid, p_subj, p_date); v_q uuid := pg_temp.q(e);
begin
  if p_box is not null then
    perform pg_temp.prog(p_kid, v_q, p_box, p_at - interval '1 hour', p_at - interval '2 days');
  end if;
  perform pg_temp.ans(p_code, p_kid, v_q, p_correct, p_at, true, p_mode);
  return pg_temp.box(p_kid, v_q);
end $$;

-- ---------------------------------------------------------------------
-- Grundlage: Familie, Eltern-Sitzung, Fach, Zeitbezug
-- ---------------------------------------------------------------------
do $$
declare
  c text := 'BCTEST-0000-0000-0000-0001'; fam uuid; k0 uuid; tok text; subj uuid;
  d0 date := (now() at time zone 'Europe/Berlin')::date; dd date; dst boolean;
begin
  insert into braincraft.families (code_hash, pin_hash)
  values (encode(extensions.digest(braincraft.norm_code(c), 'sha256'), 'hex'), extensions.crypt('1234', extensions.gen_salt('bf', 4)))
  returning id into fam;
  k0 := pg_temp.kid(fam, 'Testkind');
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into braincraft.parent_sessions (token_hash, family_id, expires_at)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), fam, now() + interval '15 minutes');
  insert into braincraft.subjects (family_id, name, icon, color_theme) values (fam, 'Testfach', 'book', 'bordeaux')
  returning id into subj;
  if now() >= timestamptz '2026-10-23 10:00+02' and now() < timestamptz '2026-11-20 00:00+01' then
    dd := date '2026-10-23'; dst := true;
  else
    dd := d0; dst := false;
  end if;
  insert into bc_ctx values (c, fam, k0, tok, subj, d0, dd, least(pg_temp.lt(dd, '10:00'), now()), dst);
end $$;

-- ---------------------------------------------------------------------
-- Abschnitt Leitner
-- ---------------------------------------------------------------------
do $$
declare
  x bc_ctx; c text; fam uuid; subj uuid; dD date; T timestamptz; M date; TM timestamptz;
  kL uuid; e uuid; q uuid; r jsonb; r2 jsonb; b int; ivl int[] := array[0, 1, 3, 6, 14];
begin
  select * into x from bc_ctx; c := x.c; fam := x.fam; subj := x.subj; dD := x.dd; T := x.t;
  kL := pg_temp.kid(fam, 'Leitner');
  perform pg_temp.chk('L01 neu, richtig -> Stufe 2, morgen 0 Uhr',
    '2 / ' || pg_temp.ts(pg_temp.lt(dD + 1)), pg_temp.lauf(c, fam, kL, subj, null, null, true, T));
  perform pg_temp.chk('L02 neu, falsch -> Stufe 1, sofort fällig',
    '1 / ' || pg_temp.ts(T), pg_temp.lauf(c, fam, kL, subj, null, null, false, T));
  for b in 1..4 loop
    perform pg_temp.chk(format('L%s Stufe %s fällig, richtig -> Stufe %s (+%s Tage)', lpad((b + 2)::text, 2, '0'), b, b + 1, ivl[b + 1]),
      (b + 1) || ' / ' || pg_temp.ts(pg_temp.lt(dD + ivl[b + 1])), pg_temp.lauf(c, fam, kL, subj, null, b, true, T));
  end loop;
  e := pg_temp.ex(fam, kL, subj, null); q := pg_temp.q(e);
  perform pg_temp.prog(kL, q, 5, T - interval '1 hour', T - interval '14 days', 4);
  perform pg_temp.ans(c, kL, q, true, T);
  perform pg_temp.chk('L07 Stufe 5 fällig, richtig -> bleibt 5, +14 Tage', '5 / ' || pg_temp.ts(pg_temp.lt(dD + 14)), pg_temp.box(kL, q));
  perform pg_temp.chk('L07b Stufe 5 richtig: consecutive_correct 4 -> 5', '5',
    (select consecutive_correct::text from braincraft.progress where profile_id = kL and question_id = q));
  perform pg_temp.chk('L08 Stufe 5 falsch -> Stufe 3, sofort fällig', '3 / ' || pg_temp.ts(T), pg_temp.lauf(c, fam, kL, subj, null, 5, false, T));
  perform pg_temp.chk('L09 Stufe 4 falsch -> Stufe 2', '2 / ' || pg_temp.ts(T), pg_temp.lauf(c, fam, kL, subj, null, 4, false, T));
  perform pg_temp.chk('L10 Stufe 2 falsch -> Stufe 1 (nicht 0)', '1 / ' || pg_temp.ts(T), pg_temp.lauf(c, fam, kL, subj, null, 2, false, T));
  perform pg_temp.chk('L11 Stufe 1 falsch -> bleibt 1', '1 / ' || pg_temp.ts(T), pg_temp.lauf(c, fam, kL, subj, null, 1, false, T));
  e := pg_temp.ex(fam, kL, subj, null); q := pg_temp.q(e);
  perform pg_temp.prog(kL, q, 3, T + interval '1 day', T - interval '2 days');
  perform pg_temp.ans(c, kL, q, true, T, true, 'chill');
  perform pg_temp.chk('L12 Stufe 3 nicht fällig, richtig (chill) -> bleibt 3', '3',
    (select leitner_box::text from braincraft.progress where profile_id = kL and question_id = q));
  -- Boss- und Chill-Antworten ändern den Leitner-Stand nicht
  perform pg_temp.chk('L15 Stufe 2 fällig, richtig (chill) -> bleibt 2, Termin bleibt', '2 / ' || pg_temp.ts(T - interval '1 hour'),
    pg_temp.lauf(c, fam, kL, subj, null, 2, true, T, 'chill'));
  perform pg_temp.chk('L16 Stufe 3, falsch (boss) -> bleibt 3', '3 / ' || pg_temp.ts(T - interval '1 hour'),
    pg_temp.lauf(c, fam, kL, subj, null, 3, false, T, 'boss'));
  perform pg_temp.chk('L17 Stufe 5, falsch (chill) -> bleibt 5', '5 / ' || pg_temp.ts(T - interval '1 hour'),
    pg_temp.lauf(c, fam, kL, subj, null, 5, false, T, 'chill'));
  e := pg_temp.ex(fam, kL, subj, null); q := pg_temp.q(e);
  r := pg_temp.ans(c, kL, q, true, T, true, 'chill');
  perform pg_temp.chk('L18 neue Frage im Chill-Modus -> keine Leitner-Zeile, leitner_changed false, 1 Stern', '0/false/1',
    (select count(*) from braincraft.progress where profile_id = kL and question_id = q) || '/' || (r->>'leitner_changed') || '/' || (r->>'stars_booked'));
  perform pg_temp.chk('L13 Antwort 23:59:59 am Vortag, Stufe 1->2 -> heute 0 Uhr',
    '2 / ' || pg_temp.ts(pg_temp.lt(dD)), pg_temp.lauf(c, fam, kL, subj, null, 1, true, pg_temp.lt(dD - 1, '23:59:59')));
  perform pg_temp.chk('L14 Antwort 00:00:00, Stufe 1->2 -> morgen 0 Uhr',
    '2 / ' || pg_temp.ts(pg_temp.lt(dD + 1)), pg_temp.lauf(c, fam, kL, subj, null, 1, true, pg_temp.lt(dD, '00:00')));
  -- Kürzen bis zum Vortag der Arbeit (Stufe 4 -> 5, normal +14 Tage)
  perform pg_temp.chk('X01 Arbeit ohne Datum -> +14 Tage', '5 / ' || pg_temp.ts(pg_temp.lt(dD + 14)), pg_temp.lauf(c, fam, kL, subj, null, 4, true, T));
  perform pg_temp.chk('X02 Arbeit heute -> wie Chill, Stand bleibt', '4 / ' || pg_temp.ts(T - interval '1 hour'), pg_temp.lauf(c, fam, kL, subj, dD, 4, true, T));
  perform pg_temp.chk('X03 Arbeit gestern -> +14 Tage', '5 / ' || pg_temp.ts(pg_temp.lt(dD + 14)), pg_temp.lauf(c, fam, kL, subj, dD - 1, 4, true, T));
  perform pg_temp.chk('X04 Arbeit morgen (heute Vortag) -> wie Chill, Stand bleibt', '4 / ' || pg_temp.ts(T - interval '1 hour'), pg_temp.lauf(c, fam, kL, subj, dD + 1, 4, true, T));
  perform pg_temp.chk('X04b Arbeit morgen, falsch -> wie Chill, Stufe bleibt', '4 / ' || pg_temp.ts(T - interval '1 hour'), pg_temp.lauf(c, fam, kL, subj, dD + 1, 4, false, T));
  perform pg_temp.chk('X08 Arbeit morgen, neue Frage -> keine Leitner-Zeile', 'NULL', coalesce(pg_temp.lauf(c, fam, kL, subj, dD + 1, null, true, T), 'NULL'));
  perform pg_temp.chk('X09 Arbeit morgen, Antwort gestern 23:59:59 -> normal (Stufe 2->3, gekürzt auf Vortag 0 Uhr)',
    '3 / ' || pg_temp.ts(pg_temp.lt(dD)), pg_temp.lauf(c, fam, kL, subj, dD + 1, 2, true, pg_temp.lt(dD - 1, '23:59:59')));
  perform pg_temp.chk('X10 Arbeit morgen, Antwort heute 00:00:00 (Vortag) -> wie Chill',
    '2 / ' || pg_temp.ts(pg_temp.lt(dD) - interval '1 hour'), pg_temp.lauf(c, fam, kL, subj, dD + 1, 2, true, pg_temp.lt(dD)));
  perform pg_temp.chk('X05 Arbeit in 5 Tagen -> Vortag 0 Uhr', '5 / ' || pg_temp.ts(pg_temp.lt(dD + 4)), pg_temp.lauf(c, fam, kL, subj, dD + 5, 4, true, T));
  perform pg_temp.chk('X06 Arbeit in 20 Tagen -> +14 Tage', '5 / ' || pg_temp.ts(pg_temp.lt(dD + 14)), pg_temp.lauf(c, fam, kL, subj, dD + 20, 4, true, T));
  perform pg_temp.chk('X07 Arbeit in 3 Tagen, Stufe 2->3 -> Vortag', '3 / ' || pg_temp.ts(pg_temp.lt(dD + 2)), pg_temp.lauf(c, fam, kL, subj, dD + 3, 2, true, T));
  -- Zeitumstellung 25.10.2026 (feste UTC-Werte)
  if x.dst then
    perform pg_temp.chk('D01 23.10. Stufe 1->2 -> 24.10. 0 Uhr MESZ', '2 / 2026-10-23 22:00:00.000000Z', pg_temp.lauf(c, fam, kL, subj, null, 1, true, T));
    perform pg_temp.chk('D02 23.10. Stufe 2->3 -> 26.10. 0 Uhr MEZ', '3 / 2026-10-25 23:00:00.000000Z', pg_temp.lauf(c, fam, kL, subj, null, 2, true, T));
    perform pg_temp.chk('D03 23.10. Stufe 3->4 -> 29.10. 0 Uhr MEZ', '4 / 2026-10-28 23:00:00.000000Z', pg_temp.lauf(c, fam, kL, subj, null, 3, true, T));
    perform pg_temp.chk('D04 Arbeit 26.10. -> Vortag 25.10. 0 Uhr MESZ', '5 / 2026-10-24 22:00:00.000000Z', pg_temp.lauf(c, fam, kL, subj, date '2026-10-26', 4, true, T));
    perform pg_temp.chk('D05 Arbeit 27.10. -> Vortag 26.10. 0 Uhr MEZ', '5 / 2026-10-25 23:00:00.000000Z', pg_temp.lauf(c, fam, kL, subj, date '2026-10-27', 4, true, T));
    -- Tagesgrenze der Sterne: derselbe Ausdruck wie in braincraft.book(), mit festem "jetzt"
    perform pg_temp.chk('D06 Sterne-Tag am 25.10. 12:00Z beginnt 24.10. 22:00Z', '2026-10-24 22:00:00.000000Z',
      pg_temp.ts(((timestamptz '2026-10-25 12:00Z' at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin'));
    perform pg_temp.chk('D07 Sterne-Tag am 25.10. 23:30 MEZ (22:30Z) beginnt 24.10. 22:00Z', '2026-10-24 22:00:00.000000Z',
      pg_temp.ts(((timestamptz '2026-10-25 22:30Z' at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin'));
    perform pg_temp.chk('D08 Sterne-Tag am 26.10. 00:30 MEZ (23:30Z) beginnt 25.10. 23:00Z', '2026-10-25 23:00:00.000000Z',
      pg_temp.ts(((timestamptz '2026-10-25 23:30Z' at time zone 'Europe/Berlin')::date)::timestamp at time zone 'Europe/Berlin'));
  else
    perform pg_temp.chk('D01-D08 Zeitumstellung (übersprungen, Lauf außerhalb 23.10.-19.11.2026)', 'skip', 'skip');
  end if;
  -- Monatsende: letzter Tag des Vormonats, falls höchstens 29 Tage her
  M := date_trunc('month', x.d0)::date - 1;
  TM := pg_temp.lt(M, '12:00');
  if now() - TM < interval '29 days' then
    perform pg_temp.chk('M01 Monatsletzter Stufe 1->2 -> 1. des Monats 0 Uhr', '2 / ' || pg_temp.ts(pg_temp.lt(M + 1)), pg_temp.lauf(c, fam, kL, subj, null, 1, true, TM));
    perform pg_temp.chk('M02 Monatsletzter Stufe 4->5 -> +14 Tage', '5 / ' || pg_temp.ts(pg_temp.lt(M + 14)), pg_temp.lauf(c, fam, kL, subj, null, 4, true, TM));
    perform pg_temp.chk('M03 Arbeit am 1. des Folgemonats (Monatsletzter = Vortag) -> wie Chill', '4 / ' || pg_temp.ts(TM - interval '1 hour'), pg_temp.lauf(c, fam, kL, subj, M + 1, 4, true, TM));
    perform pg_temp.chk('M05 Arbeit am 2. des Folgemonats -> gekürzt auf 1. 0 Uhr', '5 / ' || pg_temp.ts(pg_temp.lt(M + 1)), pg_temp.lauf(c, fam, kL, subj, M + 2, 4, true, TM));
    if x.dst then
      perform pg_temp.chk('M04 30.09. Stufe 1->2 -> 01.10. 0 Uhr MESZ', '2 / 2026-09-30 22:00:00.000000Z', pg_temp.lauf(c, fam, kL, subj, null, 1, true, TM));
    end if;
  else
    perform pg_temp.chk('M01-M04 Monatsende (übersprungen, mehr als 29 Tage her)', 'skip', 'skip');
  end if;
  -- Ältere Antwort (offline, später gesendet): Stufe und Termin bleiben, Rückgabe muss dem Gespeicherten entsprechen
  e := pg_temp.ex(fam, kL, subj, null); q := pg_temp.q(e);
  perform pg_temp.prog(kL, q, 3, T + interval '5 days', T, 2);
  r  := pg_temp.ans(c, kL, q, true,  T - interval '1 hour');
  r2 := pg_temp.ans(c, kL, q, false, T - interval '2 hours');
  perform pg_temp.chk('O01 ältere Antworten ändern Stufe/Termin nicht', '3 / ' || pg_temp.ts(T + interval '5 days'), pg_temp.box(kL, q));
  perform pg_temp.chk('O02 ältere Antworten zählen (richtig/falsch)', '1/1',
    (select correct_count || '/' || wrong_count from braincraft.progress where profile_id = kL and question_id = q));
  perform pg_temp.chk('O03 Rückgabe next_review_at (ältere richtige Antwort) = gespeicherter Wert',
    pg_temp.ts(T + interval '5 days'), pg_temp.ts((r->>'next_review_at')::timestamptz));
  perform pg_temp.chk('O04 Rückgabe next_review_at (ältere falsche Antwort) = gespeicherter Wert',
    pg_temp.ts(T + interval '5 days'), pg_temp.ts((r2->>'next_review_at')::timestamptz));
  perform pg_temp.chk('O05 ältere Antwort: leitner_changed false, leitner_box gespeichert', 'false/3',
    (r2->>'leitner_changed') || '/' || (r2->>'leitner_box'));
end $$;

-- ---------------------------------------------------------------------
-- Abschnitt Antworten
-- ---------------------------------------------------------------------
do $$
declare x bc_ctx; c text; tok text; kA uuid; kO uuid; eA uuid; eO uuid; q uuid; qe uuid; aid uuid; aid2 uuid; r jsonb;
begin
  select * into x from bc_ctx; c := x.c; tok := x.tok;
  kA := pg_temp.kid(x.fam, 'Antworten'); eA := pg_temp.ex(x.fam, kA, x.subj, null);
  kO := pg_temp.kid(x.fam, 'Anderes'); eO := pg_temp.ex(x.fam, kO, x.subj, null);
  q := pg_temp.q(eA); aid := gen_random_uuid();
  perform pg_temp.ans(c, kA, q, true, null, true, 'solo', null, aid);
  r := pg_temp.ans(c, kA, q, true, null, true, 'solo', null, aid);
  perform pg_temp.chk('A01 gleiche Antwort-ID nochmal -> duplicate', 'true', r->>'duplicate');
  perform pg_temp.chk('A02 nur 1 Antwort, 1 Stern, correct_count 1', '1/1/1',
    (select count(*) from braincraft.answers where id = aid) || '/' ||
    (select count(*) from braincraft.star_ledger where ref_id = aid) || '/' ||
    (select correct_count from braincraft.progress where profile_id = kA and question_id = q));
  q := pg_temp.q(eA);
  perform public.bc_question_set_active(c, tok, q, false);
  perform pg_temp.chk('A03 Antwort auf deaktivierte Frage -> question_not_found', 'question_not_found',
    pg_temp.err(format('select public.bc_answer(%L, %L, %L, %L, true, true, %L, null)', c, gen_random_uuid(), kA, q, 'solo')));
  r := public.bc_unit_import(c, tok, eA, null, '[]'::jsonb,
         '[{"type":"multiple_choice","prompt":"Entwurfsfrage","payload":{"options":["a","b","c","d"],"correct_index":1}}]'::jsonb);
  select id into qe from braincraft.questions where unit_id = (r->>'unit_id')::uuid;
  perform pg_temp.chk('A04 KI-Frage kommt als entwurf', 'entwurf', (select status from braincraft.questions where id = qe));
  perform pg_temp.chk('A05 Antwort auf Entwurf -> question_not_found', 'question_not_found',
    pg_temp.err(format('select public.bc_answer(%L, %L, %L, %L, true, true, %L, null)', c, gen_random_uuid(), kA, qe, 'solo')));
  perform public.bc_question_set_status(c, tok, array[qe], 'freigegeben');
  perform pg_temp.chk('A06 nach Freigabe -> Antwort möglich', 'ok',
    pg_temp.err(format('select public.bc_answer(%L, %L, %L, %L, true, true, %L, null)', c, gen_random_uuid(), kA, qe, 'solo')));
  q := pg_temp.q(eA); aid2 := gen_random_uuid();
  perform pg_temp.ans(c, kA, q, true, null, true, 'solo', null, aid2);
  perform public.bc_question_set_active(c, tok, q, false);
  perform pg_temp.chk('A07 gespeicherte Antwort erneut gesendet, Frage inzwischen deaktiviert -> duplicate (kein Fehler)', 'ok',
    pg_temp.err(format('select public.bc_answer(%L, %L, %L, %L, true, true, %L, null)', c, aid2, kA, q, 'solo')));
  perform pg_temp.chk('A08 Frage eines anderen Kindes -> question_not_found', 'question_not_found',
    pg_temp.err(format('select public.bc_answer(%L, %L, %L, %L, true, true, %L, null)', c, gen_random_uuid(), kA, pg_temp.q(eO), 'solo')));
  q := pg_temp.q(eA); aid := gen_random_uuid();
  perform pg_temp.ans(c, kA, q, false, now() + interval '2 days', true, 'solo', null, aid);
  perform pg_temp.chk('A09 Zeitpunkt in der Zukunft -> jetzt', pg_temp.ts(now()),
    (select pg_temp.ts(answered_at) from braincraft.answers where id = aid));
  q := pg_temp.q(eA); aid := gen_random_uuid();
  perform pg_temp.ans(c, kA, q, false, now() - interval '40 days', true, 'solo', null, aid);
  perform pg_temp.chk('A10 Zeitpunkt vor 40 Tagen -> vor 30 Tagen', pg_temp.ts(now() - interval '30 days'),
    (select pg_temp.ts(answered_at) from braincraft.answers where id = aid));
  -- gleiche Antwort-ID von einem anderen Kind: darf weder Fehler werfen noch etwas buchen
  q := pg_temp.q(eO);
  r := pg_temp.ans(c, kO, q, true, null, true, 'solo', null, aid2);
  perform pg_temp.chk('A11 fremde Antwort-ID (anderes Kind) -> duplicate, nichts gebucht', 'true/0',
    (r->>'duplicate') || '/' || (select count(*) from braincraft.progress where profile_id = kO and question_id = q));
end $$;

-- ---------------------------------------------------------------------
-- Abschnitt Boss
-- ---------------------------------------------------------------------
do $$
declare x bc_ctx; c text; T timestamptz; kT uuid; kB uuid; kL uuid; eT uuid; eB uuid; e uuid; q uuid; q1 uuid; q70 uuid; i int; r jsonb;
begin
  select * into x from bc_ctx; c := x.c; T := x.t;
  -- Freigabe-Schwelle: 100 Fragen, 69 auf Stufe 3
  kT := pg_temp.kid(x.fam, 'Boss70'); eT := pg_temp.ex(x.fam, kT, x.subj, null);
  for i in 1..100 loop
    q := pg_temp.q(eT);
    if i <= 69 then perform pg_temp.prog(kT, q, 3, T + interval '10 days', T - interval '1 day'); end if;
    if i = 70 then q70 := q; end if;
  end loop;
  perform pg_temp.chk('B01 69 % auf Stufe >= 3 -> gesperrt', 'boss_locked',
    pg_temp.err(format('select public.bc_boss_win(%L, %L, %L)', c, kT, eT)));
  perform pg_temp.prog(kT, q70, 4, T + interval '10 days', T - interval '1 day');
  r := public.bc_boss_win(c, kT, eT);
  perform pg_temp.chk('B02 genau 70 % -> frei, +10 Sterne, erstes Teil', '10/helm', (r->>'stars_booked') || '/' || (r->>'item_key'));
  r := public.bc_boss_win(c, kT, eT);
  perform pg_temp.chk('B03 zweiter Sieg derselben Arbeit -> duplicate', 'true', r->>'duplicate');
  perform pg_temp.chk('B04 Boss +10 einmalig: Stand 10, 1 Teil im Inventar', '10/1',
    pg_temp.bal(kT) || '/' || (select count(*) from braincraft.inventory where profile_id = kT));
  e := pg_temp.ex(x.fam, kT, x.subj, null);
  perform pg_temp.chk('B05 Arbeit mit 0 Fragen -> gesperrt', 'boss_locked',
    pg_temp.err(format('select public.bc_boss_win(%L, %L, %L)', c, kT, e)));
  -- Fehler im Boss-Kampf ("kein Verlust bei Fehlern") darf den Sieg nicht sperren
  kB := pg_temp.kid(x.fam, 'BossKampf'); eB := pg_temp.ex(x.fam, kB, x.subj, null);
  for i in 1..10 loop
    q := pg_temp.q(eB);
    if i <= 7 then perform pg_temp.prog(kB, q, 3, T + interval '10 days', T - interval '1 day'); end if;
    if i = 1 then q1 := q; end if;
  end loop;
  perform pg_temp.ans(c, kB, q1, false, T, true, 'boss');
  perform pg_temp.chk('B06 Sieg nach 1 Fehler im Boss-Kampf (vorher genau 70 %) wird gutgeschrieben', 'ok',
    pg_temp.err(format('select public.bc_boss_win(%L, %L, %L)', c, kB, eB)));
  -- Boss-Sieg an der Tagesgrenze: Sterne dürfen nicht endgültig verloren gehen
  kL := pg_temp.kid(x.fam, 'BossLimit'); e := pg_temp.ex(x.fam, kL, x.subj, null);
  for i in 1..10 loop perform pg_temp.prog(kL, pg_temp.q(e), 3, T + interval '10 days', T - interval '1 day'); end loop;
  perform pg_temp.earn(kL, 95, now());
  r := public.bc_boss_win(c, kL, e);
  perform pg_temp.chk('B07 Boss-Sieg bei 95 Sternen heute: +10 trotz Tagesgrenze, Stand 105', '10/105',
    (r->>'stars_booked') || '/' || pg_temp.bal(kL));
  perform pg_temp.chk('B08 Boss-Bonus zählt nicht zur Tagesgrenze: danach richtig -> +1', '1',
    pg_temp.ans(c, kL, pg_temp.q(e), true)->>'stars_booked');
  perform pg_temp.chk('B09 Boss-Kampf-Antworten ändern Stufen nicht: Freigabe bleibt (Kind BossKampf, Stufe Frage 1)', '3',
    (select leitner_box::text from braincraft.progress where profile_id = kB and question_id = q1));
end $$;

-- ---------------------------------------------------------------------
-- Abschnitt Sterne, Runden, Tagesgrenze
-- ---------------------------------------------------------------------
do $$
declare x bc_ctx; c text; tok text; kS uuid; kR uuid; kD uuid; kD2 uuid; kM1 uuid; kM2 uuid; eS uuid; eR uuid; e uuid; q uuid;
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); r4 uuid := gen_random_uuid(); i int; r jsonb;
begin
  select * into x from bc_ctx; c := x.c; tok := x.tok;
  kS := pg_temp.kid(x.fam, 'Sterne'); eS := pg_temp.ex(x.fam, kS, x.subj, null);
  perform pg_temp.chk('S01 richtig im 1. Versuch -> +1', '1', pg_temp.ans(c, kS, pg_temp.q(eS), true)->>'stars_booked');
  perform pg_temp.chk('S02 richtig im 2. Versuch -> 0', '0', pg_temp.ans(c, kS, pg_temp.q(eS), true, null, false)->>'stars_booked');
  perform pg_temp.chk('S03 falsch -> 0', '0', pg_temp.ans(c, kS, pg_temp.q(eS), false)->>'stars_booked');
  q := pg_temp.q(eS);
  perform pg_temp.chk('S04 Gemeinsam-Abfrage ohne Eltern-Token -> pin_required', 'pin_required',
    pg_temp.err(format('select public.bc_answer(%L, %L, %L, %L, true, true, %L, null)', c, gen_random_uuid(), kS, q, 'eltern')));
  -- Aufruf und Ledger-Abfrage getrennt: eine Unterabfrage im selben Ausdruck sieht die Buchung noch nicht
  r := pg_temp.ans(c, kS, q, true, null, true, 'eltern', tok);
  perform pg_temp.chk('S05 Gemeinsam-Abfrage mit Token -> +1 als parent_quiz', '1/1',
    (r->>'stars_booked') || '/' || (select count(*) from braincraft.star_ledger where profile_id = kS and reason = 'parent_quiz'));
  perform pg_temp.chk('S06 chill richtig -> +1', '1', pg_temp.ans(c, kS, pg_temp.q(eS), true, null, true, 'chill')->>'stars_booked');
  perform pg_temp.chk('S07 Stand nach S01-S06 = 3', '3', pg_temp.bal(kS));
  perform pg_temp.chk('S08 Korrektur unter 0 -> not_enough_stars', 'not_enough_stars',
    pg_temp.err(format('select public.bc_stars_correct(%L, %L, %L, -4, %L)', c, tok, kS, 'zu viel')));
  perform pg_temp.chk('S09 Stand nach abgelehnter Korrektur unverändert 3', '3', pg_temp.bal(kS));

  -- Rundenende (zählt Antworten mit derselben round_id)
  kR := pg_temp.kid(x.fam, 'Runde'); eR := pg_temp.ex(x.fam, kR, x.subj, null);
  for i in 1..4 loop perform pg_temp.ans(c, kR, pg_temp.q(eR), false, null, true, 'solo', null, null, r1); end loop;
  perform pg_temp.chk('R01 Rundenende mit 4 Antworten -> round_too_short', 'round_too_short',
    pg_temp.err(format('select public.bc_round_finish(%L, %L, %L)', c, r1, kR)));
  perform pg_temp.ans(c, kR, pg_temp.q(eR), false, null, true, 'solo', null, null, r1);
  perform pg_temp.chk('R02 Rundenende mit 5 Antworten -> +3', '3', public.bc_round_finish(c, r1, kR)->>'stars_booked');
  perform pg_temp.chk('R03 gleiche Runde nochmal -> 0', '0', public.bc_round_finish(c, r1, kR)->>'stars_booked');
  perform pg_temp.chk('R04 neue Runde ohne eigene Antworten -> round_too_short', 'round_too_short',
    pg_temp.err(format('select public.bc_round_finish(%L, %L, %L)', c, r2, kR)));
  for i in 1..5 loop perform pg_temp.ans(c, kR, pg_temp.q(eR), false); end loop;
  perform pg_temp.chk('R05 5 Antworten ohne round_id zählen für keine Runde', 'round_too_short',
    pg_temp.err(format('select public.bc_round_finish(%L, %L, %L)', c, r3, kR)));
  perform pg_temp.chk('R06 Stand nach Runden = 3', '3', pg_temp.bal(kR));

  -- Tagesgrenze 100
  kD := pg_temp.kid(x.fam, 'Tag99'); e := pg_temp.ex(x.fam, kD, x.subj, null);
  perform pg_temp.earn(kD, 99, now());
  perform pg_temp.chk('T01 bei 99 heute: richtig -> +1', '1', pg_temp.ans(c, kD, pg_temp.q(e), true)->>'stars_booked');
  perform pg_temp.chk('T02 bei 100 heute: richtig -> 0', '0', pg_temp.ans(c, kD, pg_temp.q(e), true)->>'stars_booked');
  perform pg_temp.chk('T03 Stand 100', '100', pg_temp.bal(kD));
  perform pg_temp.chk('T04 bc_pull stars_today = 100', '100',
    (select p->>'stars_today' from jsonb_array_elements(public.bc_pull(c)->'profiles') p where p->>'id' = kD::text));
  kD2 := pg_temp.kid(x.fam, 'Tag98'); e := pg_temp.ex(x.fam, kD2, x.subj, null);
  perform pg_temp.earn(kD2, 98, now());
  for i in 1..5 loop perform pg_temp.ans(c, kD2, pg_temp.q(e), false, null, true, 'solo', null, null, r4); end loop;
  r := public.bc_round_finish(c, r4, kD2);
  perform pg_temp.chk('T05 bei 98 heute: Rundenende (+3) überschreitet 100 nicht', 'true',
    ((select sum(delta) from braincraft.star_ledger where profile_id = kD2 and delta > 0) <= 100)::text);
  perform pg_temp.chk('T05b bei 98 heute: Rundenende auf Rest gekürzt -> +2, Stand 100', '2/100', (r->>'stars_booked') || '/' || pg_temp.bal(kD2));
  -- Grenze um Mitternacht (Zeitzone der Familie)
  kM1 := pg_temp.kid(x.fam, 'Mitternacht1'); e := pg_temp.ex(x.fam, kM1, x.subj, null);
  perform pg_temp.earn(kM1, 100, pg_temp.lt(x.d0) - interval '1 microsecond');
  perform pg_temp.chk('T06 100 Sterne bis 23:59:59.999999 gestern zählen heute nicht -> +1', '1',
    pg_temp.ans(c, kM1, pg_temp.q(e), true)->>'stars_booked');
  kM2 := pg_temp.kid(x.fam, 'Mitternacht2'); e := pg_temp.ex(x.fam, kM2, x.subj, null);
  perform pg_temp.earn(kM2, 100, pg_temp.lt(x.d0));
  perform pg_temp.chk('T07 100 Sterne um 00:00:00 heute zählen -> 0', '0',
    pg_temp.ans(c, kM2, pg_temp.q(e), true)->>'stars_booked');
end $$;

-- ---------------------------------------------------------------------
-- Abschnitt Einlösen
-- ---------------------------------------------------------------------
do $$
declare x bc_ctx; c text; tok text; kE uuid; rw uuid; rw2 uuid; rw3 uuid; r jsonb;
  id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); id3 uuid := gen_random_uuid(); id4 uuid := gen_random_uuid();
begin
  select * into x from bc_ctx; c := x.c; tok := x.tok;
  kE := pg_temp.kid(x.fam, 'Einloesen');
  perform public.bc_stars_correct(c, tok, kE, 10, 'Start');
  rw := public.bc_reward_save(c, tok, null, null, 'Testbelohnung', 'gift', 10, true);
  r := public.bc_redeem(c, id1, kE, rw);
  perform pg_temp.chk('E01 genau so viele Sterne wie Preis -> Stand 0, Gutschein offen', '0/offen',
    pg_temp.bal(kE) || '/' || (select status from braincraft.redemptions where id = id1));
  r := public.bc_redeem(c, id1, kE, rw);
  perform pg_temp.chk('E02 doppelte Anfrage (gleiche ID, Stand 0) -> duplicate', 'true', r->>'duplicate');
  perform pg_temp.chk('E03 doppelte Anfrage: 1 Gutschein, 1 Abbuchung, Stand 0', '1/1/0',
    (select count(*) from braincraft.redemptions where id = id1) || '/' ||
    (select count(*) from braincraft.star_ledger where profile_id = kE and reason = 'redeem' and ref_id = id1) || '/' || pg_temp.bal(kE));
  perform public.bc_stars_correct(c, tok, kE, 9, 'neun');
  perform pg_temp.chk('E04 ein Stern zu wenig -> not_enough_stars', 'not_enough_stars',
    pg_temp.err(format('select public.bc_redeem(%L, %L, %L, %L)', c, id2, kE, rw)));
  perform pg_temp.chk('E05 nach Ablehnung: Stand 9, kein Gutschein', '9/0',
    pg_temp.bal(kE) || '/' || (select count(*) from braincraft.redemptions where id = id2));
  perform public.bc_stars_correct(c, tok, kE, 1, 'eins');
  perform public.bc_redeem(c, id3, kE, rw);
  r := public.bc_redemption_resolve(c, tok, id3, 'storniert');
  perform pg_temp.chk('E06 Storno -> Status storniert, Sterne zurück (10)', 'storniert/10', (r->>'status') || '/' || pg_temp.bal(kE));
  perform public.bc_redemption_resolve(c, tok, id3, 'storniert');
  perform pg_temp.chk('E07 Storno doppelt -> keine zweite Rückbuchung', '10/1',
    pg_temp.bal(kE) || '/' || (select count(*) from braincraft.star_ledger where profile_id = kE and reason = 'refund'));
  r := public.bc_redeem(c, id3, kE, rw);
  perform pg_temp.chk('E08 stornierte Anfrage erneut gesendet -> duplicate, keine Abbuchung', 'true/10', (r->>'duplicate') || '/' || pg_temp.bal(kE));
  r := public.bc_redemption_resolve(c, tok, id1, 'erledigt');
  perform pg_temp.chk('E09 Erledigen -> erledigt, Stand unverändert', 'erledigt/10', (r->>'status') || '/' || pg_temp.bal(kE));
  r := public.bc_redemption_resolve(c, tok, id1, 'storniert');
  perform pg_temp.chk('E10 Storno nach Erledigen -> bleibt erledigt, keine Rückbuchung', 'erledigt/10', (r->>'status') || '/' || pg_temp.bal(kE));
  perform pg_temp.chk('E11 alte Statuswerte done/cancelled -> bad_status', 'bad_status/bad_status',
    pg_temp.err(format('select public.bc_redemption_resolve(%L, %L, %L, %L)', c, tok, id1, 'done')) || '/' ||
    pg_temp.err(format('select public.bc_redemption_resolve(%L, %L, %L, %L)', c, tok, id1, 'cancelled')));
  perform pg_temp.chk('E12 Erledigen ohne Eltern-Token -> pin_required', 'pin_required',
    pg_temp.err(format('select public.bc_redemption_resolve(%L, null, %L, %L)', c, id1, 'erledigt')));
  rw2 := public.bc_reward_save(c, tok, null, null, 'Inaktiv', 'gift', 5, false);
  perform pg_temp.chk('E13 inaktive Belohnung -> reward_not_found', 'reward_not_found',
    pg_temp.err(format('select public.bc_redeem(%L, %L, %L, %L)', c, gen_random_uuid(), kE, rw2)));
  rw3 := public.bc_reward_save(c, tok, null, x.k0, 'Nur fuer Testkind', 'gift', 5, true);
  perform pg_temp.chk('E14 Belohnung eines anderen Kindes -> reward_not_found', 'reward_not_found',
    pg_temp.err(format('select public.bc_redeem(%L, %L, %L, %L)', c, gen_random_uuid(), kE, rw3)));
  perform public.bc_redeem(c, id4, kE, rw);
  perform public.bc_reward_delete(c, tok, rw);
  r := public.bc_redemption_resolve(c, tok, id4, 'storniert');
  perform pg_temp.chk('E15 Belohnung gelöscht, dann Storno -> Stand 10, Titel bleibt', '10/Testbelohnung/true',
    pg_temp.bal(kE) || '/' || (select reward_title || '/' || (reward_id is null) from braincraft.redemptions where id = id4));
end $$;

-- ---------------------------------------------------------------------
-- Abschnitt Cron-Aufräumen (die DELETE-Befehle aus cron.job, einmal direkt ausgeführt)
-- ---------------------------------------------------------------------
do $$
declare x bc_ctx; c text; kC uuid; eC uuid; q uuid; v_cmd text; v_part text; v_led text; v_bal text; v_prog text; v_days text; n int := 0;
begin
  select * into x from bc_ctx; c := x.c;
  kC := pg_temp.kid(x.fam, 'Cron'); eC := pg_temp.ex(x.fam, kC, x.subj, null);
  q := pg_temp.q(eC);
  perform pg_temp.ans(c, kC, q, true);
  perform pg_temp.ans(c, kC, pg_temp.q(eC), true);
  insert into braincraft.answers (id, profile_id, question_id, correct, mode, answered_at) values
    (gen_random_uuid(), kC, q, true,  'solo', now() - interval '401 days'),
    (gen_random_uuid(), kC, q, false, 'solo', now() - interval '500 days'),
    (gen_random_uuid(), kC, q, true,  'solo', now() - interval '399 days');
  insert into braincraft.parent_sessions (token_hash, family_id, expires_at)
  values (encode(extensions.digest('abgelaufen-' || gen_random_uuid(), 'sha256'), 'hex'), x.fam, now() - interval '1 minute');
  insert into braincraft.invites (code_hash, created_at, expires_at, used_at, family_id) values
    (encode(extensions.digest('inv-alt-' || gen_random_uuid(), 'sha256'), 'hex'), now() - interval '40 days', now() - interval '33 days', null, null),
    (encode(extensions.digest('inv-neu-' || gen_random_uuid(), 'sha256'), 'hex'), now() - interval '1 day', now() + interval '6 days', null, null),
    (encode(extensions.digest('inv-benutzt-' || gen_random_uuid(), 'sha256'), 'hex'), now() - interval '40 days', now() - interval '33 days', now() - interval '39 days', x.fam);
  select count(*) || '/' || sum(delta) into v_led from braincraft.star_ledger;
  select string_agg(id || ':' || stars_balance, ',' order by id) into v_bal from braincraft.profiles;
  select md5(string_agg(g::text, ',' order by g.profile_id, g.question_id)) into v_prog from braincraft.progress g;
  select string_agg((p->>'id') || ':' || (p->>'learn_days_week') || ':' || (p->>'stars_today'), ',' order by p->>'id')
    into v_days from jsonb_array_elements(public.bc_pull(c)->'profiles') p;

  select command into v_cmd from cron.job where jobname = 'braincraft-aufraeumen';
  perform pg_temp.chk('C01 Cron-Job angelegt, täglich 3:17', '17 3 * * *',
    (select schedule from cron.job where jobname = 'braincraft-aufraeumen'));
  for v_part in select btrim(y, E' \n\r\t') from regexp_split_to_table(coalesce(v_cmd, ''), ';') y loop
    if v_part <> '' then execute v_part; n := n + 1; end if;
  end loop;
  perform pg_temp.chk('C02 Cron-Befehl enthält 3 DELETE', '3', n::text);
  perform pg_temp.chk('C03 Antworten älter als 400 Tage gelöscht, 399 Tage alte bleibt', '0/1',
    (select count(*) from braincraft.answers where answered_at < now() - interval '400 days') || '/' ||
    (select count(*) from braincraft.answers where profile_id = kC and answered_at < now() - interval '398 days'));
  perform pg_temp.chk('C04 aktuelle Antworten bleiben', '2',
    (select count(*)::text from braincraft.answers where profile_id = kC and answered_at > now() - interval '1 day'));
  perform pg_temp.chk('C05 abgelaufene Eltern-Sitzungen gelöscht, gültiges Token wirkt', '0/true',
    (select count(*) from braincraft.parent_sessions where expires_at < now()) || '/' || braincraft.is_parent(x.fam, x.tok));
  perform pg_temp.chk('C06 Einladungen: alte unbenutzte weg, neue und benutzte bleiben', '2',
    (select count(*)::text from braincraft.invites));
  perform pg_temp.chk('C07 Ledger unverändert', v_led, (select count(*) || '/' || sum(delta) from braincraft.star_ledger));
  perform pg_temp.chk('C08 Sterne-Stände unverändert', v_bal,
    (select string_agg(id || ':' || stars_balance, ',' order by id) from braincraft.profiles));
  perform pg_temp.chk('C09 Lernstand (progress) unverändert', v_prog,
    (select md5(string_agg(g::text, ',' order by g.profile_id, g.question_id)) from braincraft.progress g));
  perform pg_temp.chk('C10 Lerntage/Sterne heute (bc_pull) unverändert', v_days,
    (select string_agg((p->>'id') || ':' || (p->>'learn_days_week') || ':' || (p->>'stars_today'), ',' order by p->>'id')
       from jsonb_array_elements(public.bc_pull(c)->'profiles') p));
end $$;

-- ---------------------------------------------------------------------
-- Gesamt und Ergebnis: ausgeben UND alles zurückrollen (wirft immer)
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  perform pg_temp.chk('K01 Stand = Summe Ledger bei allen Kindern', '0',
    (select count(*)::text from braincraft.profiles p
      where p.stars_balance <> coalesce((select sum(delta) from braincraft.star_ledger l where l.profile_id = p.id), 0)));
  perform pg_temp.chk('K02 kein negativer Stand', '0', (select count(*)::text from braincraft.profiles where stars_balance < 0));
  select format(E'BRAINCRAFT-TEST %s/%s bestanden\n', count(*) filter (where ok), count(*))
         || string_agg(case when ok then 'OK   ' else 'FEHL ' end || name
                       || case when ok then '' else ' | erwartet: ' || erw || ' | ist: ' || ist end, E'\n' order by nr)
    into s from bc_t;
  raise exception '%', coalesce(s, 'BRAINCRAFT-TEST: keine Ergebnisse');
end $$;
