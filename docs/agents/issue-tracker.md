# Issue Tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `callstack/agent-device`. Use the `gh` CLI for issue operations.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`.
- Read an issue with `gh issue view <number> --comments`.
- List issues with `gh issue list --state open --json number,title,body,labels,comments`.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close with `gh issue close <number> --comment "..."`.

For label meanings and state flow, see `docs/agents/triage-labels.md`.

When a skill says "publish to the issue tracker", create a GitHub issue.
