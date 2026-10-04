-- PostgreSQL / Supabase schema. The in-repo server uses a JSON file for zero-setup demos;
-- this is the production mapping. The per-field merge becomes:
--   UPDATE tasks SET ..., version = version + 1 WHERE id = $1 AND version = $2;  -- 0 rows => re-read, merge, retry
CREATE TABLE projects (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE tasks (
  id serial PRIMARY KEY, project_id int REFERENCES projects ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title))>0), description text DEFAULT '',
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  assignee text, due date, version int NOT NULL DEFAULT 1);
CREATE TABLE comments (id serial PRIMARY KEY, task_id int REFERENCES tasks ON DELETE CASCADE, author text, body text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE files (id serial PRIMARY KEY, task_id int REFERENCES tasks ON DELETE CASCADE, name text, storage_path text);  -- Supabase Storage in production
CREATE TABLE activity (id serial PRIMARY KEY, actor text, message text, created_at timestamptz DEFAULT now());
