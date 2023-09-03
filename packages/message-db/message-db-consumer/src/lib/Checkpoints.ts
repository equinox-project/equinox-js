import { Pool } from "pg"

export interface ICheckpointer {
  commit(groupName: string, category: string, position: bigint): Promise<void>

  load(groupName: string, category: string): Promise<bigint>
}

export class PgCheckpoints implements ICheckpointer {
  constructor(
    private readonly pool: Pool,
    private readonly schema = "public",
  ) {}

  async load(groupName: string, category: string): Promise<bigint> {
    const result = await this.pool.query(
      `select position
       from ${this.schema}.eqx_checkpoint
       where group_name = $1
         and category = $2
       limit 1;`,
      [groupName, category],
    )
    if (result.rows.length) return BigInt(result.rows[0].position)
    await this.pool.query(
      `insert into ${this.schema}.eqx_checkpoint(group_name, category, position)
       values ($1, $2, $3)
       on conflict do nothing;`,
      [groupName, category, 0],
    )
    return 0n
  }

  async commit(groupName: string, category: string, position: bigint): Promise<void> {
    await this.pool.query(
      `update ${this.schema}.eqx_checkpoint
         set position = $3
         where group_name = $1
           and category = $2`,
      [groupName, category, String(position)],
    )
  }

  async ensureTable(pool = this.pool): Promise<void> {
    await pool.query(
      `create table if not exists ${this.schema}.eqx_checkpoint
       (
           group_name text not null,
           category   text not null,
           position   text not null,
           primary key (group_name, category)
       )`,
    )
  }
}
