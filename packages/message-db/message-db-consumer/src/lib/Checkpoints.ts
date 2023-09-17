import { Pool } from "pg"
import { ICheckpoints } from "@equinox-js/propeller"

export class PgCheckpoints implements ICheckpoints {
  constructor(
    private readonly pool: Pool,
    private readonly schema = "public",
  ) {}

  async load(
    groupName: string,
    category: string,
    establishOrigin?: (tranche: string) => Promise<bigint>,
  ): Promise<bigint> {
    const result = await this.pool.query(
      `select position
       from ${this.schema}.eqx_checkpoint
       where group_name = $1
         and category = $2
       limit 1;`,
      [groupName, category],
    )
    if (result.rows.length) return BigInt(result.rows[0].position)
    const pos = establishOrigin ? await establishOrigin(category) : 0n
    await this.pool.query(
      `insert into ${this.schema}.eqx_checkpoint(group_name, category, position)
       values ($1, $2, $3)
       on conflict do nothing;`,
      [groupName, category, pos.toString()],
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
