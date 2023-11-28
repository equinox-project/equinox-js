import { Pool } from 'pg';
import { MessageDbConnection, MessageDbContext } from '@equinox-js/message-db';
import { MemoryCache } from '@equinox-js/core';

export const pool = new Pool({
	connectionString: process.env.MDB_RO_CONN_STR,
	max: 20
});

export const connection = MessageDbConnection.create(pool);

export const context = new MessageDbContext(connection, 500);

export const cache = new MemoryCache();
