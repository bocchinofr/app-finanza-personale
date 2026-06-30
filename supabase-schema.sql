-- Esegui questo nell'editor SQL di Supabase (Database > SQL Editor > New Query)

-- Tabella movimenti
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
  persona text check (persona in ('G','F')),
  created_at timestamptz default now()
);

-- Row Level Security: ogni utente vede solo i propri dati
alter table movimenti enable row level security;

create policy "Utenti vedono solo i propri movimenti"
  on movimenti for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indici per performance
create index if not exists movimenti_user_anno on movimenti(user_id, anno);
create index if not exists movimenti_mese on movimenti(mese);
create index if not exists movimenti_categoria on movimenti(categoria);
