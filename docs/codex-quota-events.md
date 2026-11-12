# Codex quota refresh lifecycle

The opt-in Codex quota provider is event driven. It does not start an app-server
process when Nook starts, while idle, or in response to simulated UI events.
Only Codex hook payloads accepted by `connect_scanner::real_delivery` reach the
coordinator.

`UserPromptSubmit` opens a session/turn activity and requests a read. Duplicate
submissions for the same known turn coalesce. While any turn is active, one
global scheduler permits at most one read every three minutes; this scheduler
gate is the sole normal-frequency limit for event refreshes. The app-server
transport remains the existing JSONL `initialize` plus
`account/rateLimits/read` exchange. Event reads remain single-flight and retain
the existing cache TTL. After a failed read, the cache-level exponential
backoff still limits another event read; a successful read does not add a
second cooldown based on the cache's separately sampled fetch timestamp.

`Stop` closes its turn after its observed subagents finish. A final read is
coalesced with all other ending turns and waits until the three-minute global
spacing allows it. We keep that spacing for final reads too: a shorter
30–60-second exception would increase child-process churn, while stop events
from multiple sessions can be coalesced safely at the next shared interval. If
an ending turn has background work, it remains active until the matching
`SubagentStop`; `Interrupt` and `SessionEnd` close their matching activity.
Missing Stop events expire after a ten-minute inactivity lease and cause one
coalesced final read. The expired turn then remains in a bounded, 128-entry
tombstone queue for up to 20 minutes. A late tool or permission hook can restore
it; a late Stop or Interrupt requests a final read without ending a newer turn.
A turn that emits no events for ten minutes can therefore be treated as
finished even if it is still running; a later hook can reopen it during the
tombstone window. This bounds polling when a hook is lost.

The scheduler serializes reads, keeps the last valid snapshot and its
`updatedAt` after transient failures, and suppresses further attempts for a
failed turn based on `failureReason`, even when cached quotas remain available.
A new turn can request another check. A final refresh queued while another
fetch fails remains pending. With no due work the scheduler waits for a hook or
the next lease deadline, without short periodic wakeups. Disabling the opt-in clears
the cache and activity and aborts an in-flight read future. The app-server
command uses Tokio `kill_on_drop(true)`, so cancellation drops the child handle
and requests termination of that process. On Windows, the process is attached
to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; dropping the job
handle also terminates the process tree. On normal success, protocol failure,
or timeout, Nook explicitly kills the child and waits for it for up to one
second to reap it, then closes the Windows Job Object. Cancellation cannot
await that explicit reap path; it relies on child drop and the Windows Job
Object close for termination, with OS cleanup completing asynchronously.
Unknown session IDs share one bounded anonymous activity because separate
sessions cannot be distinguished without IDs; ambiguous duplicate prompt events
in that activity are coalesced.
