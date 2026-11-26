-- Disposable local stack only: give the Auth and API service roles the local password.
\set pgpass `echo "$PGPASSWORD"`
alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
