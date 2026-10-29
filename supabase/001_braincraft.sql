-- =====================================================================
-- BrainCraft 001: Schema, Funktionen, Grenzen, Storage-Bucket
-- Entwurf von Daten-Dieter, Stand 23.10.2026 (Entscheidungen Marco, docs/entscheidungen.md;
-- Befunde Sicherheits-Siggi, docs/pruefung/sicherheits-siggi-migration.md, eingearbeitet).
-- Ziel: Supabase-Projekt asfwbuptsfcrgmmgdgim (geteilt mit zaehler-app,
-- gewohnheiten, rechenstern). Legt nur neue Objekte an. NOCH NICHT EINGESPIELT.
--
-- Muster wie Rechenstern:
--  * eigenes Schema `braincraft` (nicht über die API erreichbar), RLS an, KEINE Policies.
--  * Zugriff nur über SECURITY-DEFINER-Funktionen `public.bc_*` mit Familien-Code
--    (gespeichert nur als SHA-256).
--  * Neue Familie nur mit Einladungscode (einmal gültig, 7 Tage, als Hash), den nur
--    Marco mit service_role erzeugt (bc_invite_create). Zusätzlich höchstens 20 Familien.
--  * Eltern-Aktionen mit kurzlebigem Eltern-Token (nur mit PIN; PIN als bcrypt,
--    4 Ziffern, kein Standardwert, Sperre ab 3 Fehlversuchen, Zurücksetzen nur service_role).
--    PIN ändern und Familie löschen verlangen zusätzlich die aktuelle PIN.
--  * Server-Funktionen (Edge Function "KI-Analyse") nur mit service_role.
--  * Grenzen gegen Missbrauch je Familie bzw. Kind (siehe "Grenzen" unten), Sterne höchstens 100 pro Tag
--    (knapp darunter auf den Rest gekürzt; Boss-Bonus ausgenommen).
--  * Fehler nach außen nur als eigene Codes (not_found, pin_required, limit_reached,
--    invalid_input, duplicate, ...), nie mit Datensatz-Details (braincraft.err_code).
-- Fachregeln: Leitner 0/1/3/6/14 Tage, falsch = 2 Stufen zurück (mind. 1),
--  Intervalle bis zum Arbeitsdatum gekürzt; KI-Fragen erst nach Freigabe;
--  Boss ab 70 % der Fragen auf Stufe >= 3, pro Klassenarbeit einmal; keine Herzen, keine Serie
--  ("Lerntage diese Woche" kommt aus dem Antwort-Protokoll); Heftfotos werden
--  nach der Analyse gelöscht (nur ein Scan-Auftrag bleibt, keine Bildpfade).
-- Grenzen: 5 Kinder, 30 Fächer, 200 Klassenarbeiten, 1000 Lerneinheiten und 3000 Fragen je Familie
--  (deaktivierte Fragen zählen mit), 300 Fragen je Klassenarbeit, 1500 Antworten/24 h je Familie,
--  20 Korrekturen/24 h je Familie, 50 Gutscheine/24 h und 20 offene je Kind, 100 Inventar-Teile je Kind
--  (nur aus braincraft.items), 20 Scans/24 h, 50 Belohnungen, 20 offene Einladungen.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, Typ über DO-Block, Bucket/Items ON CONFLICT,
--  cron.schedule mit festem Namen.
--
-- HINWEIS FÜR KÜNFTIGE MIGRATIONEN (Siggi N5):
--  * Ändert sich die Signatur einer public.bc_*-Funktion, die alte Fassung vorher mit
--    DROP FUNCTION entfernen. CREATE OR REPLACE legt sonst eine zweite Überladung an, und die
--    erbt über die Default-Rechte von public EXECUTE für anon.
--  * Die Rechte-Schleife am Ende dieser Datei in jeder Migration wiederholen.
-- =====================================================================

begin;

create schema if not exists braincraft;
revoke all on schema braincraft from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Typ: Fragetypen (CREATE TYPE kennt kein IF NOT EXISTS)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'braincraft' and t.typname = 'question_type'
  ) then
    create type braincraft.question_type as enum (
      'multiple_choice', 'word_clicker', 'sort_boxes', 'detective',
      'bubble_pop', 'pair_matching', 'sequencing'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Prüffunktion für payload je Fragetyp (in CHECK verwendet).
-- Fehler beim Auswerten (falscher Typ, Cast) -> false, nie NULL.
-- ---------------------------------------------------------------------
create or replace function braincraft.payload_ok(t braincraft.question_type, p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare ok boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 8000 then
    return false;
  end if;
  case t
    when 'multiple_choice' then
      ok := jsonb_array_length(p->'options') = 4
        and (select bool_and(jsonb_typeof(x) = 'string' and length(x #>> '{}') > 0)
             from jsonb_array_elements(p->'options') x)
        and (p->>'correct_index')::int between 0 and 3;
    when 'word_clicker' then
      ok := position('[GAP]' in coalesce(p->>'sentence_with_gap', '')) > 0
        and length(coalesce(p->>'correct_word', '')) > 0
        and jsonb_array_length(p->'distractors') = 3
        and (select bool_and(jsonb_typeof(x) = 'string' and length(x #>> '{}') > 0)
             from jsonb_array_elements(p->'distractors') x);
    when 'sort_boxes' then
      ok := jsonb_array_length(p->'categories') between 2 and 4
        and jsonb_array_length(p->'items') between 2 and 16
        and (select bool_and(length(coalesce(i->>'text', '')) > 0
                    and (i->>'category_index')::int between 0 and jsonb_array_length(p->'categories') - 1)
             from jsonb_array_elements(p->'items') i);
    when 'detective' then
      -- genau EIN Hochstapler pro Frage
      ok := jsonb_array_length(p->'statements') between 3 and 6
        and (select bool_and(length(coalesce(s->>'text', '')) > 0) from jsonb_array_elements(p->'statements') s)
        and (select count(*) from jsonb_array_elements(p->'statements') s
             where (s->>'is_impostor')::boolean) = 1;
    when 'bubble_pop' then
      ok := length(coalesce(p->>'target_rule', '')) > 0
        and jsonb_array_length(p->'bubbles') between 4 and 12
        and (select bool_and(length(coalesce(b->>'text', '')) > 0) from jsonb_array_elements(p->'bubbles') b)
        and exists (select 1 from jsonb_array_elements(p->'bubbles') b where (b->>'is_correct')::boolean)
        and exists (select 1 from jsonb_array_elements(p->'bubbles') b where not (b->>'is_correct')::boolean);
    when 'pair_matching' then
      ok := jsonb_array_length(p->'pairs') between 2 and 6
        and (select bool_and(length(coalesce(x->>'left', '')) > 0 and length(coalesce(x->>'right', '')) > 0)
             from jsonb_array_elements(p->'pairs') x);
    when 'sequencing' then
      ok := jsonb_array_length(p->'correct_order') between 3 and 8
        and (select bool_and(jsonb_typeof(x) = 'string' and length(x #>> '{}') > 0)
             from jsonb_array_elements(p->'correct_order') x);
    else ok := false;
  end case;
  return coalesce(ok, false);
exception when others then
  return false;
end $$;

-- Fehlercode nach außen: eigene Codes durchreichen, alles andere ohne Details abbilden (Siggi M2)
create or replace function braincraft.err_code(p_state text, p_msg text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_state = 'P0001' and p_msg ~ '^[a-z_]{3,40}( [0-9]{1,3})?$' then p_msg
    when p_state = '23505' then 'duplicate'
    when p_state = '23503' then 'invalid_reference'
    when p_state in ('23514', '23502') or p_state like '22%' then 'invalid_input'
    when p_state in ('40001', '40P01', '55P03') then 'retry'
    else 'server_error'
  end;
$$;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

-- Familie: ein Familien-Code, eine Eltern-PIN, eine Zeitzone.
create table if not exists braincraft.families (
  id               uuid primary key default gen_random_uuid(),
  code_hash        text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  pin_hash         text not null,                        -- bcrypt, nie Klartext, kein Standardwert
  pin_fails        smallint not null default 0 check (pin_fails >= 0),
  pin_locked_until timestamptz,
  timezone         text not null default 'Europe/Berlin', -- Tagesgrenzen (Leitner, Lerntage, Sterne-Tag)
  created_at       timestamptz not null default now()
);

-- Einladungscodes (nur Hash), einmal gültig, 7 Tage (Siggi H2)
create table if not exists braincraft.invites (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  family_id  uuid references braincraft.families(id) on delete set null
);
create index if not exists invites_family_idx on braincraft.invites (family_id) where family_id is not null;

-- Eltern-Sitzungen (Token nur als SHA-256, 15 Minuten gültig)
create table if not exists braincraft.parent_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  family_id  uuid not null references braincraft.families(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists parent_sessions_family_idx on braincraft.parent_sessions (family_id);

-- Kind. Sterne-Stand ist ein Cache des Ledgers. Keine Herzen, keine Serie.
create table if not exists braincraft.profiles (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references braincraft.families(id) on delete cascade,
  child_name    text not null check (char_length(btrim(child_name)) between 1 and 30),
  avatar_id     text not null default 'pilot' check (avatar_id ~ '^[a-z0-9_]{1,40}$'),
  stars_balance integer not null default 0 check (stars_balance >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (family_id, id)
);
create index if not exists profiles_family_idx on braincraft.profiles (family_id);

create table if not exists braincraft.subjects (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references braincraft.families(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  icon        text not null check (icon ~ '^[a-z0-9-]{1,40}$'),
  color_theme text not null check (color_theme ~ '^[a-z0-9_-]{1,30}$'),
  created_at  timestamptz not null default now(),
  unique (family_id, id),
  unique (family_id, name)
);

-- Klassenarbeit gehört zu genau einem Kind und einem Fach derselben Familie.
create table if not exists braincraft.exams (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references braincraft.families(id) on delete cascade,
  profile_id  uuid not null,
  subject_id  uuid not null,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  exam_date   date,                                       -- Tag ohne Uhrzeit (Vorabend = Kalendertag davor)
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (family_id, id),
  foreign key (family_id, profile_id) references braincraft.profiles (family_id, id) on delete cascade,
  -- Fach mit Klassenarbeiten lässt sich nicht löschen (NO ACTION, damit Familien-Löschung kaskadiert)
  foreign key (family_id, subject_id) references braincraft.subjects (family_id, id) on delete no action
);
create index if not exists exams_profile_idx on braincraft.exams (family_id, profile_id);
create index if not exists exams_subject_idx on braincraft.exams (family_id, subject_id);

-- Scan-Auftrag: Heftfotos liegen nur vorübergehend im privaten Bucket bc-scans
-- unter "<family_id>/<job_id>/". Nach der Analyse löscht die Edge Function sie
-- und setzt images_deleted_at. Es werden keine Bildpfade dauerhaft gespeichert.
create table if not exists braincraft.scan_jobs (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references braincraft.families(id) on delete cascade,
  exam_id           uuid not null references braincraft.exams(id) on delete cascade,
  image_count       smallint not null check (image_count between 1 and 10),
  status            text not null default 'hochladen'
                    check (status in ('hochladen', 'analyse', 'fertig', 'fehler')),
  error             text check (char_length(error) <= 200),
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  images_deleted_at timestamptz,
  check ((status in ('fertig', 'fehler')) = (finished_at is not null))
);
create index if not exists scan_jobs_family_idx on braincraft.scan_jobs (family_id, created_at);
create index if not exists scan_jobs_exam_idx on braincraft.scan_jobs (exam_id);
create index if not exists scan_jobs_open_idx on braincraft.scan_jobs (created_at) where images_deleted_at is null;

-- Lerneinheit (Folien) aus einem Scan.
create table if not exists braincraft.learning_units (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references braincraft.exams(id) on delete cascade,
  scan_job_id    uuid references braincraft.scan_jobs(id) on delete set null,
  summary_slides jsonb not null default '[]'
                 check (jsonb_typeof(summary_slides) = 'array' and pg_column_size(summary_slides) <= 20000),
  created_at     timestamptz not null default now(),
  unique (exam_id, id)
);
create index if not exists learning_units_scan_idx on braincraft.learning_units (scan_job_id) where scan_job_id is not null;

-- Frage: nur Inhalt. KI-Fragen starten als 'entwurf', das Kind sieht nur 'freigegeben'.
create table if not exists braincraft.questions (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references braincraft.exams(id) on delete cascade,
  unit_id    uuid,                                         -- optional, muss zur selben Klassenarbeit gehören
  type       braincraft.question_type not null,
  prompt     text not null check (char_length(btrim(prompt)) between 1 and 500),
  payload    jsonb not null,
  status     text not null default 'entwurf' check (status in ('entwurf', 'freigegeben')),
  is_active  boolean not null default true,                -- Löschen = deaktivieren, Verlauf bleibt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_payload_ok check (braincraft.payload_ok(type, payload)),
  foreign key (exam_id, unit_id) references braincraft.learning_units (exam_id, id) on delete cascade
);
create index if not exists questions_exam_idx on braincraft.questions (exam_id, status) where is_active;
create index if not exists questions_exam_all_idx on braincraft.questions (exam_id);
create index if not exists questions_unit_idx on braincraft.questions (exam_id, unit_id) where unit_id is not null;

-- Leitner-Stand pro Kind und Frage. Keine Zeile = noch nie gesehen.
create table if not exists braincraft.progress (
  profile_id          uuid not null references braincraft.profiles(id) on delete cascade,
  question_id         uuid not null references braincraft.questions(id) on delete cascade,
  leitner_box         smallint not null default 1 check (leitner_box between 1 and 5),
  consecutive_correct smallint not null default 0 check (consecutive_correct >= 0),
  correct_count       integer not null default 0 check (correct_count >= 0),
  wrong_count         integer not null default 0 check (wrong_count >= 0),
  next_review_at      timestamptz not null,
  last_answered_at    timestamptz not null,
  primary key (profile_id, question_id)
);
create index if not exists progress_question_idx on braincraft.progress (question_id);
create index if not exists progress_due_idx on braincraft.progress (profile_id, next_review_at);

-- Antwort-Protokoll (Analytik, "Lerntage diese Woche"). ID vom Gerät -> doppelt senden ist harmlos.
-- round_id verbindet die Antworten einer Runde (Rundenende-Sterne, Siggi N4).
create table if not exists braincraft.answers (
  id          uuid primary key,
  profile_id  uuid not null references braincraft.profiles(id) on delete cascade,
  question_id uuid not null references braincraft.questions(id) on delete cascade,
  round_id    uuid,
  correct     boolean not null,
  first_try   boolean not null default true,
  mode        text not null check (mode in ('solo', 'eltern', 'boss', 'chill')),
  answered_at timestamptz not null,
  received_at timestamptz not null default now(),
  device      text check (char_length(device) <= 60)
);
create index if not exists answers_profile_idx on braincraft.answers (profile_id, answered_at);
create index if not exists answers_received_idx on braincraft.answers (profile_id, received_at);
create index if not exists answers_question_idx on braincraft.answers (question_id);
create index if not exists answers_round_idx on braincraft.answers (profile_id, round_id) where round_id is not null;

-- Sterne-Ledger: jede Buchung nachvollziehbar; profiles.stars_balance = Summe(delta).
create table if not exists braincraft.star_ledger (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references braincraft.profiles(id) on delete cascade,
  delta      integer not null check (delta <> 0 and delta between -100000 and 100000),
  reason     text not null check (reason in ('answer', 'round', 'parent_quiz', 'boss', 'redeem', 'refund', 'correction')),
  ref_id     uuid,                                         -- Antwort, Runde, Klassenarbeit (Boss) oder Gutschein
  note       text check (char_length(note) <= 80),
  created_at timestamptz not null default now(),
  unique (profile_id, reason, ref_id)                       -- dieselbe Buchung nie zweimal
);
create index if not exists star_ledger_profile_idx on braincraft.star_ledger (profile_id, created_at);

-- Belohnungen legen die Eltern selbst an (Beispiel-Stufen 60/100/300 nur in der App, keine Startdaten).
create table if not exists braincraft.rewards (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references braincraft.families(id) on delete cascade,
  profile_id uuid,                                          -- null = für alle Kinder der Familie
  title      text not null check (char_length(btrim(title)) between 1 and 60),
  icon       text not null default 'gamepad-2' check (icon ~ '^[a-z0-9-]{1,40}$'),
  cost_stars integer not null check (cost_stars between 1 and 100000),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (family_id, profile_id) references braincraft.profiles (family_id, id) on delete cascade
);
create index if not exists rewards_family_idx on braincraft.rewards (family_id);
create index if not exists rewards_profile_idx on braincraft.rewards (family_id, profile_id) where profile_id is not null;

-- Gutschein. Belohnung löschen darf Gutscheine NICHT mitlöschen.
create table if not exists braincraft.redemptions (
  id           uuid primary key,                            -- ID vom Gerät (idempotent)
  profile_id   uuid not null references braincraft.profiles(id) on delete cascade,
  reward_id    uuid references braincraft.rewards(id) on delete set null,
  reward_title text not null check (char_length(reward_title) between 1 and 60),
  cost_stars   integer not null check (cost_stars > 0),
  status       text not null default 'offen' check (status in ('offen', 'erledigt', 'storniert')),
  redeemed_at  timestamptz not null default now(),
  resolved_at  timestamptz,
  check ((status = 'offen') = (resolved_at is null))
);
create index if not exists redemptions_profile_idx on braincraft.redemptions (profile_id, status);
create index if not exists redemptions_day_idx on braincraft.redemptions (profile_id, redeemed_at);
create index if not exists redemptions_reward_idx on braincraft.redemptions (reward_id);

-- Feste Liste der Inventar-Teile (Siggi H1). Platzhalter-Begriffe, bis die Begriffsliste
-- von Gestaltungs-Greta steht; neue Teile kommen per Migration dazu.
create table if not exists braincraft.items (
  item_key text primary key check (item_key ~ '^[a-z0-9_]{1,60}$'),
  title_de text not null check (char_length(title_de) between 1 and 60),
  title_en text not null check (char_length(title_en) between 1 and 60),
  sort     smallint not null unique
);
insert into braincraft.items (item_key, title_de, title_en, sort) values
  ('helm', 'Helm', 'Helmet', 1), ('handschuhe', 'Handschuhe', 'Gloves', 2), ('stiefel', 'Stiefel', 'Boots', 3),
  ('schild', 'Schild', 'Shield', 4), ('umhang', 'Umhang', 'Cape', 5), ('guertel', 'Gürtel', 'Belt', 6),
  ('kompass', 'Kompass', 'Compass', 7), ('fernglas', 'Fernglas', 'Binoculars', 8), ('abzeichen', 'Abzeichen', 'Badge', 9),
  ('fluegel', 'Flügel', 'Wings', 10), ('pokal', 'Pokal', 'Trophy', 11), ('krone', 'Krone', 'Crown', 12)
on conflict (item_key) do nothing;

-- Inventar pro Kind: nur Teile aus braincraft.items, jedes höchstens einmal
create table if not exists braincraft.inventory (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references braincraft.profiles(id) on delete cascade,
  item_key    text not null references braincraft.items(item_key),
  exam_id     uuid references braincraft.exams(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  unique (profile_id, item_key)
);
create index if not exists inventory_exam_idx on braincraft.inventory (exam_id);
create index if not exists inventory_item_idx on braincraft.inventory (item_key);

-- Boss-Siege: pro Kind und Klassenarbeit höchstens einer (Siggi H1)
create table if not exists braincraft.boss_wins (
  profile_id uuid not null references braincraft.profiles(id) on delete cascade,
  exam_id    uuid not null references braincraft.exams(id) on delete cascade,
  item_key   text references braincraft.items(item_key),
  won_at     timestamptz not null default now(),
  primary key (profile_id, exam_id)
);
create index if not exists boss_wins_exam_idx on braincraft.boss_wins (exam_id);
create index if not exists boss_wins_item_idx on braincraft.boss_wins (item_key);

-- RLS an, keine Policies (wie Rechenstern)
alter table braincraft.families        enable row level security;
alter table braincraft.invites         enable row level security;
alter table braincraft.parent_sessions enable row level security;
alter table braincraft.profiles        enable row level security;
alter table braincraft.subjects        enable row level security;
alter table braincraft.exams           enable row level security;
alter table braincraft.scan_jobs       enable row level security;
alter table braincraft.learning_units  enable row level security;
alter table braincraft.questions       enable row level security;
alter table braincraft.progress        enable row level security;
alter table braincraft.answers         enable row level security;
alter table braincraft.star_ledger     enable row level security;
alter table braincraft.rewards         enable row level security;
alter table braincraft.redemptions     enable row level security;
alter table braincraft.items           enable row level security;
alter table braincraft.inventory       enable row level security;
alter table braincraft.boss_wins       enable row level security;

-- ---------------------------------------------------------------------
-- Interne Helfer (Schema braincraft, für die API unsichtbar)
-- ---------------------------------------------------------------------

create or replace function braincraft.norm_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Familien-Code -> Familie (Code höchstens 64 Zeichen, Siggi N3)
create or replace function braincraft.family(p_code text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v text; f uuid;
begin
  if p_code is not null and length(p_code) <= 64 then
    v := braincraft.norm_code(p_code);
    if length(v) >= 20 then
      select id into f from braincraft.families where code_hash = encode(extensions.digest(v, 'sha256'), 'hex');
    end if;
  end if;
  if f is null then raise exception 'not_found'; end if;
  return f;
end $$;

-- Eltern-Token gültig? (Token genau 64 Hex-Zeichen, Siggi N3)
create or replace function braincraft.is_parent(p_family uuid, p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_token is not null and p_token ~ '^[0-9a-f]{64}$' and exists (
    select 1 from braincraft.parent_sessions s
    where s.family_id = p_family and s.expires_at > now()
      and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex'));
$$;

-- Familie + gültiges Eltern-Token, sonst 'pin_required'
create or replace function braincraft.parent(p_code text, p_token text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code);
begin
  if not braincraft.is_parent(f, p_token) then raise exception 'pin_required'; end if;
  return f;
end $$;

-- PIN prüfen mit Fehlzähler. Wirft nie (sonst wäre der Zähler zurückgerollt).
-- Sperre ab 3 Fehlversuchen: 1, 2, 4, ... Minuten, höchstens 24 h (Siggi M1).
create or replace function braincraft.pin_verify(p_family uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_until timestamptz;
begin
  select pin_hash, pin_locked_until into r from braincraft.families where id = p_family for update;
  if r.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'pin_locked', 'locked_until', r.pin_locked_until);
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' or extensions.crypt(p_pin, r.pin_hash) <> r.pin_hash then
    update braincraft.families
       set pin_fails = least(pin_fails + 1, 100),
           pin_locked_until = case when pin_fails + 1 >= 3
             then now() + least(interval '1 minute' * power(2, least(pin_fails + 1 - 3, 12)), interval '24 hours') end
     where id = p_family returning pin_locked_until into v_until;
    return jsonb_build_object('ok', false, 'error', 'pin_wrong', 'locked_until', v_until);
  end if;
  update braincraft.families set pin_fails = 0, pin_locked_until = null where id = p_family;
  return jsonb_build_object('ok', true);
end $$;

create or replace function braincraft.need_profile(p_family uuid, p_profile uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from braincraft.profiles where id = p_profile and family_id = p_family) then
    raise exception 'profile_not_found';
  end if;
end $$;

-- Nur mit service_role. Leerer Claim -> forbidden statt JSON-Fehler (Siggi M2).
create or replace function braincraft.nur_server()
returns void language plpgsql stable set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
end $$;

-- Leitner-Intervalle in Tagen: Stufe 1 sofort, dann 1/3/6/14 Tage.
create or replace function braincraft.interval_days(p_box smallint)
returns integer language sql immutable set search_path = '' as $$
  select case p_box when 1 then 0 when 2 then 1 when 3 then 3 when 4 then 6 else 14 end;
$$;

-- Sterne buchen: sperrt das Kind, bucht höchstens einmal je (Grund, Bezug), verhindert negativen Stand.
-- Technische Obergrenze: 100 verdiente Sterne pro Kalendertag (Zeitzone der Familie) für
-- answer/round/parent_quiz; knapp darunter wird auf den Rest gekürzt (98 + 3 -> +2).
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
    v_delta := least(v_delta, 100 - v_earned);
    if v_delta <= 0 then return 0; end if;
  end if;
  insert into braincraft.star_ledger (profile_id, delta, reason, ref_id, note)
  values (p_profile, v_delta, p_reason, p_ref, left(p_note, 80));
  update braincraft.profiles set stars_balance = stars_balance + v_delta, updated_at = now() where id = p_profile;
  return v_delta;
end $$;

-- ---------------------------------------------------------------------
-- Öffentliche Funktionen public.bc_* (für die App)
-- Fehler nur als eigene Codes (siehe braincraft.err_code).
-- ---------------------------------------------------------------------

-- Nur Marco (service_role): Einladungscode für eine neue Familie, einmal gültig, 7 Tage.
-- Der Code wird nur hier im Klartext zurückgegeben und nur als Hash gespeichert.
create or replace function public.bc_invite_create()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_bytes bytea; v_code text := ''; i int;
begin
  perform braincraft.nur_server();
  if (select count(*) from braincraft.invites where used_at is null and expires_at > now()) >= 20 then
    raise exception 'limit_reached';
  end if;
  v_bytes := extensions.gen_random_bytes(16);
  for i in 0..15 loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into braincraft.invites (code_hash, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '7 days');
  return jsonb_build_object('invite', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-'
                                      || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4),
                            'expires_at', now() + interval '7 days');
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Familie anlegen: Einladungscode, Familien-Code (>= 20 Zeichen), erster Kindername, Eltern-PIN (4 Ziffern)
create or replace function public.bc_create(p_invite text, p_code text, p_child_name text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text; v_inv text; f uuid; k uuid;
begin
  if p_invite is null or length(p_invite) > 64 or p_code is null or length(p_code) > 64 then
    raise exception 'invalid_input';
  end if;
  v := braincraft.norm_code(p_code);
  v_inv := encode(extensions.digest(braincraft.norm_code(p_invite), 'sha256'), 'hex');
  if length(v) < 20 then raise exception 'code_too_short'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  perform 1 from braincraft.invites where code_hash = v_inv and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invite_invalid'; end if;
  if (select count(*) from braincraft.families) >= 20 then raise exception 'limit_reached'; end if;
  insert into braincraft.families (code_hash, pin_hash)
  values (encode(extensions.digest(v, 'sha256'), 'hex'), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  returning id into f;
  insert into braincraft.profiles (family_id, child_name) values (f, btrim(p_child_name)) returning id into k;
  update braincraft.invites set used_at = now(), family_id = f where code_hash = v_inv;
  return jsonb_build_object('family_id', f, 'profile_id', k);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- PIN prüfen -> Eltern-Token (15 Min.). Falsche PIN: {ok:false, error, locked_until}, kein raise.
create or replace function public.bc_parent_unlock(p_code text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); v jsonb; v_tok text;
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
end $$;

create or replace function public.bc_parent_lock(p_code text, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code);
begin
  if p_token is not null and length(p_token) <= 128 then
    delete from braincraft.parent_sessions
     where family_id = f and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Für die Edge Function: prüft Eltern-Token, liefert family_id
create or replace function public.bc_parent_check(p_code text, p_token text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  return braincraft.parent(p_code, p_token);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- PIN ändern: Eltern-Token UND aktuelle PIN (Siggi M3). Falsche PIN zählt als Fehlversuch.
create or replace function public.bc_pin_set(p_code text, p_token text, p_pin text, p_new_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v jsonb;
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
end $$;

-- PIN vergessen: nur Marco mit service_role. Liefert true, wenn die Familie existiert (Siggi N1).
create or replace function public.bc_pin_reset(p_family_id uuid, p_new_pin text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_found boolean;
begin
  perform braincraft.nur_server();
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  update braincraft.families
     set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)), pin_fails = 0, pin_locked_until = null
   where id = p_family_id;
  v_found := found;
  delete from braincraft.parent_sessions where family_id = p_family_id;
  return v_found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Gesamter Stand der Familie. Ohne Eltern-Token nur freigegebene Fragen; mit Token auch Entwürfe und Scan-Aufträge.
-- "Lerntage diese Woche" = verschiedene Kalendertage mit Antworten seit Montag (Zeitzone der Familie).
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
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'exam_id', q.exam_id, 'unit_id', q.unit_id, 'type', q.type, 'prompt', q.prompt,
        'payload', q.payload, 'status', q.status))
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

-- Kind anlegen/ändern (Eltern). p_id null = neu. Höchstens 5 Kinder.
-- Fremde IDs werden nie erkannt (nur eigene Familie, Siggi N2).
create or replace function public.bc_profile_save(p_code text, p_token text, p_id uuid, p_child_name text, p_avatar_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v uuid;
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
end $$;

-- Kind löschen (Eltern). Das letzte Kind bleibt.
create or replace function public.bc_profile_delete(p_code text, p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token);
begin
  if (select count(*) from braincraft.profiles where family_id = f) <= 1 then raise exception 'last_profile'; end if;
  delete from braincraft.profiles where id = p_id and family_id = f;
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

create or replace function public.bc_subject_save(p_code text, p_token text, p_id uuid, p_name text, p_icon text, p_color_theme text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v uuid;
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
end $$;

create or replace function public.bc_subject_delete(p_code text, p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token);
begin
  if exists (select 1 from braincraft.exams where subject_id = p_id and family_id = f) then
    raise exception 'subject_in_use';
  end if;
  delete from braincraft.subjects where id = p_id and family_id = f;
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

create or replace function public.bc_exam_save(p_code text, p_token text, p_id uuid, p_profile_id uuid, p_subject_id uuid,
                                               p_title text, p_exam_date date, p_is_archived boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v uuid;
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
end $$;

-- Klassenarbeit löschen (mit Fragen, Fortschritt, Antworten).
-- Liefert Storage-Präfixe von Scan-Aufträgen, deren Fotos noch nicht gelöscht sind.
create or replace function public.bc_exam_delete(p_code text, p_token text, p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v_prefixes text[];
begin
  select coalesce(array_agg(j.family_id::text || '/' || j.id::text || '/'), '{}') into v_prefixes
    from braincraft.scan_jobs j where j.exam_id = p_id and j.family_id = f and j.images_deleted_at is null;
  delete from braincraft.exams where id = p_id and family_id = f;
  if not found then raise exception 'not_found'; end if;
  return v_prefixes;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Scan beginnen (Eltern): legt einen Auftrag an. Die Edge Function erzeugt damit
-- Upload-URLs für "<family_id>/<job_id>/1.jpg" ... im privaten Bucket bc-scans.
create or replace function public.bc_scan_start(p_code text, p_token text, p_exam_id uuid, p_image_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v uuid;
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
end $$;

-- Nur Server (Edge Function): Status setzen und melden, dass die Fotos gelöscht sind.
create or replace function public.bc_scan_update(p_job_id uuid, p_status text, p_images_deleted boolean, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform braincraft.nur_server();
  update braincraft.scan_jobs
     set status = coalesce(p_status, status),
         finished_at = case when coalesce(p_status, status) in ('fertig', 'fehler') then coalesce(finished_at, now()) end,
         error = left(p_error, 200),
         images_deleted_at = case when p_images_deleted then coalesce(images_deleted_at, now()) else images_deleted_at end
   where id = p_job_id;
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Nur Server: Präfixe von Aufträgen, deren Fotos nach 1 Stunde noch nicht gelöscht sind (Aufräumen).
create or replace function public.bc_scan_stale()
returns table (job_id uuid, prefix text) language plpgsql stable security definer set search_path = '' as $$
begin
  perform braincraft.nur_server();
  return query
    select j.id, j.family_id::text || '/' || j.id::text || '/'
      from braincraft.scan_jobs j
     where j.images_deleted_at is null and j.created_at < now() - interval '1 hour'
     order by j.created_at limit 200;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Analyse-Ergebnis übernehmen (Eltern), alles oder nichts. Fragen kommen als 'entwurf'.
-- p_questions: [{type, prompt, payload}, ...]. Gleiche Frage (Typ + Text) wird übersprungen;
-- enthält der Import nur Duplikate, entsteht keine Lerneinheit (Siggi H1).
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

  -- neue (nicht doppelte) Fragen zählen
  select count(*) into v_new from (
    select distinct lower(btrim(x->>'prompt')), x->>'type'
      from jsonb_array_elements(p_questions) x
     where not exists (select 1 from braincraft.questions o
                        where o.exam_id = p_exam_id and o.is_active
                          and o.type = (x->>'type')::braincraft.question_type
                          and lower(o.prompt) = lower(btrim(x->>'prompt')))) c;
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
  select distinct on (lower(btrim(x->>'prompt')), x->>'type')
         p_exam_id, v_unit, (x->>'type')::braincraft.question_type, btrim(x->>'prompt'), x->'payload', 'entwurf'
    from jsonb_array_elements(p_questions) x
   where not exists (select 1 from braincraft.questions o
                      where o.exam_id = p_exam_id and o.is_active
                        and o.type = (x->>'type')::braincraft.question_type
                        and lower(o.prompt) = lower(btrim(x->>'prompt')));
  get diagnostics v_new = row_count;
  return jsonb_build_object('unit_id', v_unit, 'inserted', v_new);
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Frage bearbeiten (Eltern). Fortschritt bleibt.
create or replace function public.bc_question_save(p_code text, p_token text, p_id uuid, p_prompt text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token);
begin
  update braincraft.questions q set prompt = btrim(p_prompt), payload = p_payload, updated_at = now()
   where q.id = p_id and exists (select 1 from braincraft.exams e where e.id = q.exam_id and e.family_id = f);
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Fragen freigeben oder zurück auf Entwurf (Eltern), mehrere auf einmal. Liefert die Anzahl.
create or replace function public.bc_question_set_status(p_code text, p_token text, p_ids uuid[], p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); n integer;
begin
  if p_status is null or p_status not in ('entwurf', 'freigegeben') then raise exception 'bad_status'; end if;
  if cardinality(coalesce(p_ids, '{}')) > 300 then raise exception 'limit_reached'; end if;
  update braincraft.questions q set status = p_status, updated_at = now()
   where q.id = any(p_ids) and exists (select 1 from braincraft.exams e where e.id = q.exam_id and e.family_id = f);
  get diagnostics n = row_count;
  return n;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Frage löschen = deaktivieren (Verlauf bleibt). Mit p_active = true wiederherstellen.
create or replace function public.bc_question_set_active(p_code text, p_token text, p_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token);
begin
  update braincraft.questions q set is_active = coalesce(p_active, false), updated_at = now()
   where q.id = p_id and exists (select 1 from braincraft.exams e where e.id = q.exam_id and e.family_id = f);
  if not found then raise exception 'not_found'; end if;
  return true;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

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
-- Grenze: 1500 Antworten in 24 h je Familie. Doppelte Antwort-ID -> {ok, duplicate} (wird zuerst geprüft).
create or replace function public.bc_answer(p_code text, p_answer_id uuid, p_profile_id uuid, p_question_id uuid,
                                            p_correct boolean, p_first_try boolean, p_mode text, p_answered_at timestamptz,
                                            p_token text default null, p_device text default null, p_round_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f uuid := braincraft.family(p_code);
  tz text; v_at timestamptz; v_day date; v_exam date; pr braincraft.progress%rowtype;
  v_box smallint; v_cc smallint; v_next timestamptz; v_stars integer; v_booked integer := 0; v_frozen boolean;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_answer_id is null or p_correct is null then raise exception 'bad_answer'; end if;
  if exists (select 1 from braincraft.answers where id = p_answer_id and profile_id = p_profile_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_mode is null or p_mode not in ('solo', 'eltern', 'boss', 'chill') then raise exception 'bad_mode'; end if;
  if p_mode = 'eltern' then perform braincraft.parent(p_code, p_token); end if;
  select e.exam_date into v_exam
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
  if v_stars > 0 then
    v_booked := braincraft.book(p_profile_id, v_stars,
                                case when p_mode = 'eltern' then 'parent_quiz' else 'answer' end, p_answer_id, null);
  end if;

  return jsonb_build_object('ok', true, 'leitner_changed', not v_frozen, 'leitner_box', v_box, 'next_review_at', v_next,
    'stars_booked', v_booked,
    'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Rundenende: +3 Sterne, einmal je Runde. Nur wenn es zu dieser round_id mindestens
-- 5 Antworten dieses Kindes gibt (Siggi N4).
create or replace function public.bc_round_finish(p_code text, p_round_id uuid, p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); v_booked integer;
begin
  perform braincraft.need_profile(f, p_profile_id);
  if p_round_id is null then raise exception 'bad_round'; end if;
  if (select count(*) from braincraft.answers where profile_id = p_profile_id and round_id = p_round_id) < 5 then
    raise exception 'round_too_short';
  end if;
  v_booked := braincraft.book(p_profile_id, 3, 'round', p_round_id, null);
  return jsonb_build_object('ok', true, 'stars_booked', v_booked,
    'stars_balance', (select stars_balance from braincraft.profiles where id = p_profile_id));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Boss besiegt: +10 Sterne und das nächste noch fehlende Teil aus braincraft.items.
-- Nur wenn freigeschaltet (70 % der freigegebenen Fragen auf Stufe >= 3), pro Kind und
-- Klassenarbeit nur einmal, höchstens 100 Teile je Kind (Siggi H1). Das Teil wählt der Server.
create or replace function public.bc_boss_win(p_code text, p_profile_id uuid, p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); v_total integer; v_master integer; v_booked integer; v_item text;
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
end $$;

-- Belohnungen (Eltern). Keine Startdaten; die App schlägt 60/100/300 Sterne als Beispiel vor.
create or replace function public.bc_reward_save(p_code text, p_token text, p_id uuid, p_profile_id uuid,
                                                 p_title text, p_icon text, p_cost_stars integer, p_is_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v uuid;
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
end $$;

-- Belohnung löschen: Gutscheine behalten Titel und Preis (reward_id wird null)
create or replace function public.bc_reward_delete(p_code text, p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token);
begin
  delete from braincraft.rewards where id = p_id and family_id = f;
  return found;
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- Einlösen (Kind): atomar, nie negativer Stand, idempotent über p_redemption_id.
-- Grenzen je Kind: 20 offene, 50 in 24 h (auch stornierte zählen, Siggi H1).
create or replace function public.bc_redeem(p_code text, p_redemption_id uuid, p_profile_id uuid, p_reward_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.family(p_code); r record; v_booked integer;
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
end $$;

-- Gutschein erledigt oder storniert (Eltern). Storno bucht die Sterne zurück.
create or replace function public.bc_redemption_resolve(p_code text, p_token text, p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); r record;
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
end $$;

-- Sterne von Hand korrigieren (Eltern), mit Notiz im Ledger. Höchstens 20 in 24 h je Familie.
create or replace function public.bc_stars_correct(p_code text, p_token text, p_profile_id uuid, p_delta integer, p_note text)
returns integer language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token);
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
end $$;

-- Familie komplett löschen (Datenschutz): Eltern-Token UND aktuelle PIN (Siggi M3).
-- Liefert {ok, scan_prefixes} mit offenen Scan-Präfixen zum Aufräumen im Storage.
create or replace function public.bc_family_delete(p_code text, p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := braincraft.parent(p_code, p_token); v jsonb; v_prefixes text[];
begin
  v := braincraft.pin_verify(f, p_pin);
  if not (v->>'ok')::boolean then return v; end if;
  select coalesce(array_agg(j.family_id::text || '/' || j.id::text || '/'), '{}') into v_prefixes
    from braincraft.scan_jobs j where j.family_id = f and j.images_deleted_at is null;
  delete from braincraft.families where id = f;
  return jsonb_build_object('ok', true, 'scan_prefixes', to_jsonb(v_prefixes));
exception when others then raise exception using message = braincraft.err_code(sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- Rechte: Schema und Helfer zu, nur public.bc_* ausführbar.
-- (Die Default-Privilegien im Projekt geben anon sonst EXECUTE auf neue public-Funktionen.)
-- In jeder künftigen Migration wiederholen (Siggi N5).
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
    if r.proname in ('bc_pin_reset', 'bc_scan_update', 'bc_scan_stale', 'bc_invite_create') then
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Storage: privater Bucket für Heftfotos (nur vorübergehend). Keine Policies auf storage.objects
-- -> nur service_role (Edge Function) erzeugt Upload-URLs, liest und löscht.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bc-scans', 'bc-scans', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Aufräumen per pg_cron (von Marco freigegeben am 23.10.2026), täglich 3:17 UTC:
-- abgelaufene Eltern-Sitzungen, Antworten älter als 400 Tage, abgelaufene Einladungen.
-- Liegengebliebene Fotos löscht die Edge Function (Schritt 2) über bc_scan_stale(),
-- weil Storage-Objekte nur über die Storage-API gelöscht werden dürfen.
select cron.schedule('braincraft-aufraeumen', '17 3 * * *', $c$
  delete from braincraft.parent_sessions where expires_at < now();
  delete from braincraft.answers where answered_at < now() - interval '400 days';
  delete from braincraft.invites where used_at is null and expires_at < now() - interval '30 days';
$c$);

commit;
