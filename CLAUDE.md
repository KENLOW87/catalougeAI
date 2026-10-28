# Continuing this project in Claude

Read **AGENTS.md in full**, then the **Latest handoff** section of **HANDOFF.md**.
Those files contain the user's binding preservation rules and the saved state as
of 28 October 2026. Older handoff/README design notes may be superseded by them.

The user asked to save all work and continue here. Wait for their next instruction;
do not redesign, reset the working tree, clear browser data, export PDFs, or make
paid OpenAI requests as an unsolicited startup check.

The current working tree includes substantial saved, uncommitted work. Preserve it.
Catalogue data lives in the user's browser IndexedDB, not in source control. New
usage logs live in ignored `app/data/activity/`; keep them. Credentials are in
ignored server configuration and must never be printed or committed.

The daily 17:30 Malaysia usage reminder is already configured in the Codex app;
it is not a repository cron job. Do not create a duplicate reminder.
