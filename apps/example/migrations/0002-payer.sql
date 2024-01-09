create table if not exists payer (
  id uuid not null primary key,
  version bigint not null,
  name text not null,
  email text not null
);

grant SELECT, INSERT, UPDATE, TRUNCATE on payer to equinox_example;
