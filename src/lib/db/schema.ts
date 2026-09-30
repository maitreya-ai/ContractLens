/**
 * Schema shared by PGlite (embedded) and any Postgres with pgvector (Supabase, Neon, RDS...).
 * Every statement is idempotent so it can run on each boot.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS workspaces (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          text NOT NULL,            -- contract | paste | document
  title         text NOT NULL,
  chain_id      integer,
  address       text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id            text PRIMARY KEY,
  source_id     text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path          text NOT NULL,
  language      text NOT NULL,            -- solidity | markdown | text
  role          text NOT NULL,            -- target | project | library | document
  content       text NOT NULL,
  line_count    integer NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id       text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind          text NOT NULL,            -- outline | function | declarations | section | window
  symbol        text,
  container     text,
  start_line    integer NOT NULL,
  end_line      integer NOT NULL,
  content       text NOT NULL,
  blocks        jsonb NOT NULL,           -- [{t, s, e}] citable line groups
  tags          jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_text   text NOT NULL,
  embedding     vector(384) NOT NULL,
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED
);

CREATE INDEX IF NOT EXISTS chunks_workspace_idx ON chunks (workspace_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS signals (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id       text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  severity      text NOT NULL,            -- high | warn | info
  line          integer NOT NULL,
  symbol        text,
  detail        text NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_workspace_idx ON signals (workspace_id);

CREATE TABLE IF NOT EXISTS reports (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model         text NOT NULL,
  report        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_workspace_idx ON reports (workspace_id, created_at DESC);
`;
