/**
 * Host half of the conversation-links bundle.
 *
 * All cross-conversation reading in this plugin happens on the Client through
 * the Session runtime (`sessions.retain()` + `eventSource`), and all insertion
 * happens through the composer input shell. The Host half therefore has no
 * services to register; it only exists because a bundle row must resolve to a
 * module with an `apply()` export.
 */
export function apply() {}
