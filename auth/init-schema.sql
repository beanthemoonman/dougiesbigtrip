-- Runs once, on an empty pgdata volume, via the postgres image's
-- /docker-entrypoint-initdb.d hook.
--
-- Keycloak's Liquibase migrations do NOT create their own schema — pointing
-- KC_DB_SCHEMA at a missing schema fails at boot. The app schema is created by
-- the Rust server's own migrations (server/migrations/001_initial.sql).
create schema if not exists keycloak;
