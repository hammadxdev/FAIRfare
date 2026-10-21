# Disposable PostgreSQL integration baseline

`src/db/schema.sql` is SQLite-specific and is not a PostgreSQL bootstrap. It
uses SQLite `AUTOINCREMENT`, SQLite datetime expressions, and integer primary
keys that do not match the UUID/timestamptz PostgreSQL objects used by the
application migrations.

The authoritative repository evidence for PostgreSQL is the ordered migration
chain:

`001` through `016`, in numeric order.

The chain assumes an existing PostgreSQL database with the required Supabase
compatibility/auth objects and privileges. The repository does not contain a
complete empty-database PostgreSQL bootstrap or an authoritative schema dump.
Consequently, a disposable integration database must be provisioned by an
approved database owner from the reviewed PostgreSQL baseline. Do not run the
SQLite schema or infer missing PostgreSQL DDL from it.

Migration 016 depends on objects created by 015 and remains unapplied locally.
The integration runner must complete its server-identity preflight before the
application receives `DATABASE_URL`.
