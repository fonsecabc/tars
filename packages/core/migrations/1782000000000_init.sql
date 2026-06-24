-- Up Migration

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Registries -----------------------------------------------------------------
-- Entity types and relation predicates are OPEN vocabularies. These tables make
-- them first-class: listable, describable, auto-registered on first use.

CREATE TABLE entity_types (
  name        text PRIMARY KEY,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  usage_count integer NOT NULL DEFAULT 0
);

CREATE TABLE relation_predicates (
  name        text PRIMARY KEY,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  usage_count integer NOT NULL DEFAULT 0
);

-- Seed suggested starter entity types. This is NOT a closed set: unknown types are
-- accepted and auto-registered. No predicates are seeded (they emerge from use).
INSERT INTO entity_types (name, description) VALUES
  ('person',       'A human being.'),
  ('organization', 'A company, team, institution, or group.'),
  ('project',      'A piece of work with a goal.'),
  ('trip',         'A journey or travel.'),
  ('place',        'A location.'),
  ('event',        'Something that happens at a time.'),
  ('asset',        'A possession or resource.'),
  ('idea',         'A thought, concept, or plan.'),
  ('document',     'A file, note, or written artifact.')
ON CONFLICT (name) DO NOTHING;

-- Entities -------------------------------------------------------------------

CREATE TABLE entities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL REFERENCES entity_types (name),
  name       text NOT NULL,
  aliases    text[] NOT NULL DEFAULT '{}',
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- Maintained by the trigger below. This cannot be a GENERATED column because
  -- array_to_string() is only STABLE, not IMMUTABLE; the FTS document still covers
  -- the entity name + all aliases.
  search_tsv tsvector
);

CREATE FUNCTION entities_search_tsv_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv := to_tsvector(
    'simple',
    coalesce(NEW.name, '') || ' ' || array_to_string(NEW.aliases, ' ')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER entities_search_tsv_trg
  BEFORE INSERT OR UPDATE OF name, aliases ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_search_tsv_refresh();

CREATE INDEX entities_type_idx       ON entities (type) WHERE deleted_at IS NULL;
CREATE INDEX entities_search_tsv_idx ON entities USING gin (search_tsv);
CREATE INDEX entities_name_trgm_idx  ON entities USING gin (name gin_trgm_ops);
CREATE INDEX entities_metadata_idx   ON entities USING gin (metadata jsonb_path_ops);

-- Observations ---------------------------------------------------------------
-- Bi-temporal: facts carry a validity interval and are never destructively
-- overwritten. A correction closes the old row's valid_to and inserts a new row
-- whose corrects_id points back at it.

CREATE TABLE observations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  text        text NOT NULL,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'manual'
                CHECK (source IN ('chat', 'manual', 'import', 'extraction')),
  confidence  real NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  tags        text[] NOT NULL DEFAULT '{}',
  corrects_id uuid REFERENCES observations (id) ON DELETE SET NULL,
  embedding   vector(768),
  deleted_at  timestamptz,
  search_tsv  tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
);

CREATE INDEX observations_entity_idx     ON observations (entity_id) WHERE deleted_at IS NULL;
CREATE INDEX observations_search_tsv_idx ON observations USING gin (search_tsv);
CREATE INDEX observations_text_trgm_idx  ON observations USING gin (text gin_trgm_ops);
CREATE INDEX observations_valid_idx      ON observations (valid_from, valid_to);
CREATE INDEX observations_tags_idx       ON observations USING gin (tags);
-- ANN index for vector retrieval (Phase 4). Empty/all-NULL is fine to build now.
CREATE INDEX observations_embedding_idx  ON observations USING hnsw (embedding vector_cosine_ops);

-- Relations ------------------------------------------------------------------

CREATE TABLE relations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  to_entity   uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  predicate   text NOT NULL REFERENCES relation_predicates (name),
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb NOT NULL DEFAULT '{}',
  deleted_at  timestamptz
);

CREATE INDEX relations_from_idx      ON relations (from_entity) WHERE deleted_at IS NULL;
CREATE INDEX relations_to_idx        ON relations (to_entity) WHERE deleted_at IS NULL;
CREATE INDEX relations_predicate_idx ON relations (predicate);

-- Audit log ------------------------------------------------------------------
-- Append-only. Every write and delete records a row here.

CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  action      text NOT NULL,
  target_kind text NOT NULL,
  target_id   text NOT NULL,
  source      text,
  detail      jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_at_idx     ON audit_log (at);
CREATE INDEX audit_log_target_idx ON audit_log (target_kind, target_id);

-- Down Migration

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS relations;
DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS entities;
DROP FUNCTION IF EXISTS entities_search_tsv_refresh();
DROP TABLE IF EXISTS relation_predicates;
DROP TABLE IF EXISTS entity_types;
-- Extensions are intentionally left installed.
