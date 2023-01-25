import { MessageDbWriter } from "./MessageDbClient"
import { StreamEvent } from "@equinox-js/core"
import { SpanKind, trace } from "@opentelemetry/api"

const tracer = trace.getTracer("@birdiecare/eqx-message-db", "1.0.0")

type SyncResult =
  | { type: "Written"; position: bigint }
  | { type: "ConflictUnknown" }

export function writeEvents(
  conn: MessageDbWriter,
  category: string,
  streamId: string,
  streamName: string,
  version: bigint | null,
  events: StreamEvent[]
): Promise<SyncResult> {
  return tracer.startActiveSpan(
    "WriteEvents",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "eqx.category": category,
        "eqx.stream_id": streamId,
        "eqx.stream_name": streamName,
        "eqx.expected_version": Number(version),
        "eqx.count": events.length,
      },
    },
    (span) =>
      conn.writeMessages(streamName, events, version).finally(() => span.end())
  )
}
