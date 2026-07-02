-- ============================================================
-- MIGRAZIONE: esegui questo nell'editor SQL di Supabase
-- (Database > SQL Editor > New Query)
-- Se hai già la tabella "movimenti" da prima, questo script
-- la aggiorna senza perdere i dati esistenti.
-- ============================================================

-- 1) Tabella movimenti (crea se non esiste)
create table if not exists movimenti (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  anno integer not null,
  mese text not null,
  data_operazione text,
  descrizione text,
  entrate numeric(12,2) default 0,
  uscite numeric(12,2) default 0,
  categoria text,
  sottocategoria text,
  nome_etf text,
  componente text,
  created_at timestamptz default now()
);

-- Se la tabella esisteva già con la vecchia colonna "persona" + vincolo G/F:
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='movimenti' and column_name='persona') then
    alter table movimenti rename column persona to componente;
    alter table movimenti drop constraint if exists movimenti_persona_check;
  end if;
end $$;

alter table movimenti alter column componente drop not null;

alter table movimenti enable row level security;

drop policy if exists "Utenti vedono solo i propri movimenti" on movimenti;
create policy "Utenti vedono solo i propri movimenti"
  on movimenti for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists movimenti_user_anno on movimenti(user_id, anno);
create index if not exists movimenti_mese on movimenti(mese);
create index if not exists movimenti_categoria on movimenti(categoria);
create index if not exists movimenti_componente on movimenti(componente);


-- ============================================================
-- 2) Tabella profili utente — ID del foglio Google personale
-- ============================================================
create table if not exists profili (
  user_id uuid references auth.users(id) on delete cascade primary key,
  google_sheet_id text,
  nome_visualizzato text,
  updated_at timestamptz default now()
);

alter table profili enable row level security;

drop policy if exists "Utenti vedono solo il proprio profilo" on profili;
create policy "Utenti vedono solo il proprio profilo"
  on profili for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Crea automaticamente un profilo vuoto alla registrazione
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profili (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Per gli utenti già registrati prima di questo trigger, crea il profilo ora:
insert into public.profili (user_id)
select id from auth.users
on conflict (user_id) do nothing;
