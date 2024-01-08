create table if not exists payer (
  id uuid not null primary key,
  name text not null,
  email text not null
);

grant SELECT, INSERT, UPDATE, TRUNCATE on payer to equinox_example;
