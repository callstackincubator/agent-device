---
name: react-devtools-profile-report
description: Create shareable HTML performance reports from React DevTools profiler exports captured with agent-device or agent-react-devtools. Use when converting a React profile JSON/export/link into an HTML page, summarizing slow React render commits, comparing render offenders, or preparing a profile report for another person to inspect.
---

# react-devtools-profile-report

Create a local HTML report from a React DevTools profiler export. Use this with `agent-device react-devtools profile export` after profiling a React Native interaction.

Before planning commands, read current CLI guidance:

```bash
agent-device help react-devtools
```

Preferred workflow:

```bash
agent-device react-devtools status
agent-device react-devtools wait --connected
agent-device react-devtools profile start
# perform the interaction with normal agent-device commands
agent-device react-devtools profile stop
agent-device react-devtools profile slow --limit 10
agent-device react-devtools profile rerenders --limit 10
agent-device react-devtools profile export profile.json
node <this-skill>/scripts/profile-json-to-html.mjs profile.json profile.html --title "React Profile Report"
```

Keep the profile window narrow. If the export includes startup and the investigated interaction, call out that the slowest React render commit may be initial mount noise and rank later commits/components separately.

Use the bundled converter when the user asks for an HTML page:

```bash
node <this-skill>/scripts/profile-json-to-html.mjs <profile.json> <report.html> \
  --title "Driver login React Profile" \
  --evidence screenshot.png
```

The script expects the React DevTools export shape with `dataForRoots`. It produces a standalone HTML file with summary cards, a render-commit timeline, slowest components, highest total render time, most rerenders, and slowest React render commits.

Terminology:

- "React render commit" means one React Profiler commit/update cycle, not a Git commit.
- "Actual duration" is React render work for a component subtree in a commit.
- "Self duration" is time attributed to the component itself when available.
- Render causes come from profiler change descriptions when the export includes them.

If Chrome or another browser blocks direct `file://` viewing, serve the directory locally instead:

```bash
python3 -m http.server 47651 --bind 127.0.0.1
```

Then open `http://127.0.0.1:47651/<report.html>`.
