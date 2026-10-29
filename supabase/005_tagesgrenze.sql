-- =====================================================================
-- BrainCraft 005: Tagesgrenze 40 Sterne, Boss nach dem Sieg ohne Sterne, Teile-Namen
-- Entwurf von Daten-Dieter, Stand 28.10.2026 (docs/entscheidungen.md, 28.10.2026
-- „Boss-Fight und Gemeinsam-Abfragen“; Plan docs/plan-boss-gemeinsam.md).
-- Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim. Setzt 001-004 voraus. NOCH NICHT EINGESPIELT.
--
--  * Neue Funktion braincraft.stars_daily_limit() = 40: die Tagesgrenze steht nur hier.
--    Nur intern (Schema braincraft, kein EXECUTE für anon/authenticated).
--  * braincraft.book(): Grenze 40 statt 100 für answer/round/parent_quiz, sonst unverändert:
--    Kürzung auf den Rest (38 + 3 -> +2), Kalendertag in der Zeitzone der Familie,
--    Boss-Siegbonus ('boss') ausgenommen, Einlösen/Storno/Korrektur ausgenommen.
--    Gezählt werden dieselben Gründe wie in bc_pull 'stars_today' (bc_pull bleibt unverändert):
--      answer      = Arena solo/chill UND Boss-Antworten (1 je richtig im 1. Versuch)
--      parent_quiz = Gemeinsam-Abfragen (bc_answer mode 'eltern')
--      round       = Rundenbonus +3
--    Hatte ein Kind am Einspieltag schon mehr als 40, bucht es heute nichts mehr (kein Abzug).
--  * public.bc_answer: im Modus 'boss' keine Sterne mehr, sobald es für Kind und Klassenarbeit
--    der Frage einen Eintrag in boss_wins gibt (Boss erneut spielbar ohne Belohnung).
--    Antwort, Zähler und Rückgabe sonst unverändert (stars_booked = 0). Signatur gleich.
--  * public.bc_round_finish: +3 nur, wenn mindestens 5 Antworten der Runde mode 'solo' oder 'chill'
--    haben; Boss- und Gemeinsam-Antworten zählen nicht (Siggi, siggi-005.md a). Signatur gleich.
--  * public.bc_boss_win bleibt unverändert: zweiter Sieg -> {ok, duplicate}, keine Buchung,
--    kein Teil (geprüft im Probelauf).
--  * Teile-Namen und Reihenfolge nach der endgültigen Liste von Gestaltungs-Greta
--    (docs/begriffe-boss.md, 28.10.2026), z. B. helm -> Pilotenhelm; item_key bleiben.
--  * Ändert keine Zeilen außer ggf. braincraft.items (Namen/Reihenfolge).
-- Idempotent: CREATE OR REPLACE, Teile-Update mit festen Werten, Rechte-Schleife wie 001-004 (Siggi N5).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Tagesgrenze: die eine Stelle für die Zahl
-- ---------------------------------------------------------------------
create or replace function braincraft.stars_daily_limit()
returns integer language sql immutable set search_path = '' as $$
  select 40;
$$;

-- Sterne buchen: sperrt das Kind, bucht höchstens einmal je (Grund, Bezug), verhindert negativen Stand.
-- Tagesgrenze braincraft.stars_daily_limit() verdiente Sterne pro Kalendertag (Zeitzone der Familie) für
-- answer/round/parent_quiz; knapp darunter wird auf den Rest gekürzt (38 + 3 -> +2).
-- Der Boss-Bonus ist ausgenommen (schon durch "einmal je Kind und Klassenarbeit" begrenzt).
-- Rückgabe: tatsächlich gebuchter Betrag, 0 = nichts gebucht (schon gebucht oder Tagesgrenze erreicht).
create or replace function braincraft.book(p_profile uuid, p_delta integer, p_reason text, p_ref uuid, p_note text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_bal integer; v_earned integer; v_tz text; v_delta integer := p_delta;
begin
  select p.stars_balance, f.timezone into v_bal, v_tz
    from braincraft.profiles p join braincraft.families f on f.id = p.family_id
   where p.id = p_profile for update of p;
  if v_bal is null then raise exception 'profile_not_found'; end if;
  if p_ref is not null and exists (
    select 1 from braincraft.star_ledger where profile_id = p_profile and reason = p_reason and ref_id = p_ref
  ) then return 0; end if;
  if v_bal + v_delta < 0 then raise exception 'not_enough_stars'; end if;
  if v_delta > 0 and p_reason in ('answer', 'round', 'parent_quiz') then
    select coalesce(sum(delta), 0) into v_earned from braincraft.star_ledger
     where profile_id = p_profile and delta > 0 and reason in ('answer', 'round', 'parent_quiz')
       and created_at >= ((now() at time zone v_tz)::date)::timestamp at time zone v_tz;
    v_delta := least(v_delta, braincraft.stars_daily_limit() - v_earned);
    if v_delta <= 0 then return 0; end if;
  end if;
  insert into braincraft.star_ledger (profile_id, delta, reason, ref_id, note)
  values (p_profile, v_delta, p_reason, p_ref, left(p_note, 80));
  update braincraft.profiles set stars_balance = stars_balance + v_delta, updated_at = now() where id = p_profile;
  return v_delta;
end $$;

-- ---------------------------------------------------------------------
-- Antworten: Boss nach dem Sieg ohne Sterne (Rumpf sonst wie 001)
-- ---------------------------------------------------------------------
-- Antwort verbuchen: Protokoll, Leitner, Sterne. Idempotent über p_answer_id (vom Gerät).
-- Leitner (Lern-Lotte):
--   neu: richtig -> Stufe 2, falsch -> Stufe 1
--   richtig UND fällig -> eine Stufe hoch (max. 5); richtig, aber nicht fällig -> Stufe bleibt
--   falsch -> 2 Stufen zurück (mind. 1), sofort wieder fällig (Rundenende)
--   Intervall 0/1/3/6/14 Tage, gekürzt bis zum Vortag der Klassenarbeit
-- Ohne jede Änderung am Leitner-Stand (nur Protokoll und Zähler):
--   Modus 'boss' und 'chill'; Vorabend-Schutz: ab 0:00 am Vortag der Arbeit und am Tag der Arbeit
--   (Zeitzone der Familie, erzwingt der Server); ältere Antworten (offline, später gesendet).
--   Zurückgegeben wird dann der gespeicherte Stand.
-- Sterne: 1 bei richtig im ersten Versuch (solo/boss/chill), Gemeinsam-Abfragen (Eltern-Token) 1.
--   Boss-Modus nach dem Sieg über diese Klassenarbeit: keine Sterne mehr (005, Entscheidung 28.10.2026).
--   Tagesgrenze siehe braincraft.book() / braincraft.stars_daily_limit().
-- Grenze: 1500 Antworten in 24 h je Familie. Doppelte Antwort-ID -> {ok, duplicate} (wird zuerst geprüft).
create or replace function public.bc_answer(p_code text, p_answer_id uuid, p_profile_id uuid, p_question_id uuid,
                                            p_correct boolean, p_first_try boolean, p_mode text, p_answered_at timestamptz,
                                            p_token text default null, p_device text default null, p_round_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f uuid := braincraft.family(p_code);
  tz text; v_at timestamptz; v_day date; v_exam date; v_exam_id uuid; pr braincraft.progress%rowtype;
  v_box smallint; v_cc smallint; v_next timestamptz; v_stars integer; v_booked integer := 0; v_frozen boolean;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_answer_id is null or p_correct is null then raise exception 'bad_answer'; end if;
  if exists (select 1 from braincraft.answers where id = p_answer_id and profile_id = p_profile_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_mode is null or p_mode not in ('solo', 'eltern', 'boss', 'chill') then raise exception 'bad_mode'; end if;
  if p_mode = 'eltern' then perform braincraft.parent(p_code, p_token); end if;
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
end $$;

-- ---------------------------------------------------------------------
-- Rundenbonus nur für Arena-Runden (Siggi, docs/pruefung/siggi-005.md, Entscheidung a)
-- ---------------------------------------------------------------------
-- Rundenende: +3 Sterne, einmal je Runde. Nur wenn es zu dieser round_id mindestens
-- 5 Antworten dieses Kindes gibt (Siggi N4).
-- Nur Arena-Antworten (solo/chill) zählen; Boss und Gemeinsam ohne Rundenbonus (005).
create or replace function public.bc_round_finish(p_code text, p_round_id uuid, p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); v_booked integer;
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
end $$;

-- ---------------------------------------------------------------------
-- Teile-Namen (Gestaltungs-Greta, docs/begriffe-boss.md)
-- Endgültige Liste von Gestaltungs-Greta (28.10.2026). item_key bleibt (Inventar und Boss-Siege
-- verweisen darauf); neu sind Namen und Reihenfolge (guertel 4, schild 5, umhang 6, fernglas 7, kompass 8).
-- bc_boss_win vergibt das nächste fehlende Teil nach sort; schon gewonnene Teile bleiben.
-- sort ist eindeutig: erst alle auf -neu, dann umdrehen, damit Tauschen nicht an UNIQUE scheitert.
-- Bricht ab, wenn nicht genau 12 bekannte Teile getroffen werden (Tippfehler im Schlüssel).
-- ---------------------------------------------------------------------
do $$
declare n integer;
begin
  update braincraft.items it
     set title_de = v.title_de, title_en = v.title_en, sort = -v.sort
    from (values
      ('helm',       'Pilotenhelm',     'Pilot helmet',      1),
      ('handschuhe', 'Rennhandschuhe',  'Racing gloves',     2),
      ('stiefel',    'Turbo-Stiefel',   'Turbo boots',       3),
      ('guertel',    'Werkzeuggürtel',  'Tool belt',         4),
      ('schild',     'Blockschild',     'Block shield',      5),
      ('umhang',     'Windumhang',      'Wind cape',         6),
      ('fernglas',   'Adler-Fernglas',  'Eagle binoculars',  7),
      ('kompass',    'Sternenkompass',  'Star compass',      8),
      ('abzeichen',  'Rennabzeichen',   'Racing badge',      9),
      ('fluegel',    'Düsenflügel',     'Jet wings',         10),
      ('pokal',      'Siegerpokal',     'Winner''s trophy',  11),
      ('krone',      'Sternenkrone',    'Star crown',        12)
    ) as v(item_key, title_de, title_en, sort)
   where it.item_key = v.item_key;
  get diagnostics n = row_count;
  if n <> 12 then raise exception 'items: % statt 12 Teile getroffen', n; end if;
  update braincraft.items set sort = -sort where sort < 0;
end $$;

-- ---------------------------------------------------------------------
-- Rechte: wie 003/004 (Siggi N5)
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
