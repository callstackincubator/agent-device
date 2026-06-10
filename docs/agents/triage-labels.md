# Issue Label Workflow

This repo uses labels for issue state, not executor type.

| GitHub label | Meaning |
| --- | --- |
| `needs-triage` | New or unreviewed issue; maintainer needs to evaluate it |
| `in-progress` | Someone has started work on the issue |
| `needs-info` | Waiting on reporter or external input |
| `wontfix` | Will not be actioned after an explicit maintainer decision |

Default flow:

1. New issues get `needs-triage`.
2. Remove `needs-triage` once the issue is understood and valid.
3. Add `in-progress` and assign the active owner when work starts.
4. Leave a triaged, unassigned issue without a state label when it is available work.
5. Remove `in-progress` when the issue closes or the work is abandoned.

Do not use `ready-for-agent`, `ready-for-human`, or other executor-specific labels.
