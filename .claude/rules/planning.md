# Working preferences

## Planning and implementation

- **Plans are written by the main session**, at whatever model and effort that
  session is already running. Never delegate authoring a plan to a subagent, and
  never drop to a cheaper model to write one. Research agents (`Explore`, `Plan`)
  leave `model` unset so they inherit the session model too.
- **Implementation is delegated to Sonnet.** Once a plan is agreed, hand each
  substantial step to the `implementer` subagent via the Agent tool with
  `model: "sonnet"`. Substantial means it touches more than one file, or is more
  than a couple of lines. One-line fixes, typos, renames and follow-up tweaks
  stay inline — a subagent round-trip costs more than the edit does.
- **Each brief must stand alone**: the goal, the files by repo-relative path, the
  conventions to follow, and what "done" looks like. The subagent starts cold and
  cannot see the conversation.
- **The main session stays the reviewer**: read the returned diff, run the tests
  and linters, and make the commit. Never commit a subagent's work unread.
- Independent steps can run as parallel `implementer` agents. Steps that touch
  the same files must be sequenced.
