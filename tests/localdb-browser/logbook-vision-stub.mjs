// Synthetic stand-in for the vision model, used ONLY by the local browser suite
// (loaded by the dev server when TAXIFLOW_LOGBOOK_VISION_STUB names this file).
// Each synthetic test page carries the reply the "model" should give after the
// end of its PNG data (browsers ignore those bytes); this stub returns it. No
// network, no key, no real logbook data.
export const STUB_MARKER = "\nsynthetic-logbook-reply:";

export const withStubReply = (pngBuffer, reply) =>
  Buffer.concat([pngBuffer, Buffer.from(`${STUB_MARKER}${Buffer.from(JSON.stringify(reply)).toString("base64")}`)]);

export default {
  messages: {
    create: async (request) => {
      const image = Buffer.from(request.messages[0].content[0].source.data, "base64").toString("latin1");
      const at = image.lastIndexOf(STUB_MARKER);
      const text = at < 0 ? JSON.stringify({ rows: [], pageNote: "Not a synthetic test page." }) : Buffer.from(image.slice(at + STUB_MARKER.length), "base64").toString("utf8");
      return { stop_reason: "end_turn", content: [{ type: "text", text }] };
    },
  },
};
