import { connection } from '$lib/context';

/** @type {import('$types').PageLoad} */
export async function load({ params }) {
	const events = await connection.read.readStream(params.stream_name, 0n, 500, false);

	return { stream_name: params.stream_name, events };
}
