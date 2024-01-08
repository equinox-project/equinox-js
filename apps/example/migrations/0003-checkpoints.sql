create table if not exists public.eqx_checkpoint (
   group_name text not null,
   category   text not null,
   position   text not null,
   primary key (group_name, category)
)
