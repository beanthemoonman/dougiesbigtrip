-- Phase 18.1 — app schema. The `keycloak` schema is created by
-- auth/init-schema.sql (Keycloak's own migrations do not create it).
create schema if not exists app;

create table if not exists app.users (
    sub          text primary key,                -- Keycloak subject
    display_name text not null,
    email        text,
    first_seen   timestamptz not null default now(),
    last_seen    timestamptz not null default now()
);

create table if not exists app.server_config (
    id             int primary key default 1 check (id = 1),  -- single row
    bot_count      int  not null default 6,
    map            text not null default 'de_douglas',
    rounds_to_win  int  not null default 16,
    updated_at     timestamptz not null default now(),
    updated_by     text references app.users(sub)
);
