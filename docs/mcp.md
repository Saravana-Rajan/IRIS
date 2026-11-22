# Iris for agents (MCP)

Any MCP client can work on an Iris session:
- Gemini CLI;
- an IDE.

The agent sees the models, the clashes and their pictures. It can:
- check its own ideas against the model;
- run Iris's fix agent;
- apply fixes;
- triage;
- build the report;
- export the edited models.

When a person has Iris open, their page follows along: the camera moves to the clash the agent shows, and fixes
appear as the agent applies them.

Code:
- `server/iris/mcp_server.py`: the tools;
- `server/iris/agents.py`: links, the page's channel, jobs;
- the routes and the `/mcp` mount in `app.py`;
- `web/src/Agent.tsx`: the dialog.

## Connecting

**Remote, to the session you have open.** In Iris, choose **Connect an agent**, then **Make a link for this session**.

**After the first time, only the token changes.** The dialog leads with the token (masked; show and copy) and the
server URL, so a new session means pasting one value into your agent's settings. Or set it up once with
`"Bearer ${Iris_TOKEN}"` (in clients that interpolate environment variables) and change only `Iris_TOKEN`.

The full settings for each client are under **First time? Set up your agent**:

```bash
# Gemini CLI
gemini mcp add --transport http iris https://<host>/mcp --header "Authorization: Bearer <token>"
```

```json
// Gemini CLI settings (~/.gemini/settings.json or the project's .gemini/settings.json)
{ "mcpServers": { "iris": { "httpUrl": "https://<host>/mcp",
  "headers": { "Authorization": "Bearer <token>" } } } }
```

- **Any other client:** connect over Streamable HTTP to `https://<host>/mcp` with the header
  `Authorization: Bearer <token>`.
- **Clients that cannot set headers:** use `https://<host>/mcp?key=<token>`.

**Local, over stdio.** This is a session of its own with no browser: open models with `open_models`, then work on them.

```bash
cd server && uv run python -m iris.mcp_server
```

## Tools

| | Tools |
|---|---|
| Session | `get_session` (what is open, whether a browser follows), `list_models`, `open_models` |
| Clashes | `detect_clashes` (all models, or a check of what side A takes against B: one of the person's filters by name, as `get_session` lists them, what their filters show together, `{"shown": true}`, or elements described as for `set_filters`; B defaults to everything the full check covers), `report_summary`, `list_clashes`, `get_clash`, `get_clash_images` (A/B/C pictures), `measure_clash`, `find_root_causes`, `find_patterns`, `triage` |
| The model | `describe_element`, `find_elements`, `find_openings` |
| Fixes | `check_move`, `check_offset`, `check_route`, `check_resize`, `check_penetration`, `check_seat` (test the agent's own idea), `propose_fixes` (Iris's fix agent), `plan_fixes_together`, `plan_root_cause`, `get_job`, `apply_fix`, `apply_plan` |
| Hand edits | `list_faces`, `check_edit` (push/pull, align, move, void, cut by shape, split, remove a section, delete, clip; the page previews it), `apply_edit` (checked again, logged as the agent's; `accept_clashes` only when the person asked), `list_edits`, `undo_edit`, `redo_edit` ([manual-edits.md](manual-edits.md)) |
| The person's view | `show_clash`, `set_view`, `set_filters` / `clear_filters` (colour, hide or isolate by property: [filters.md](filters.md)), `capture_view` (a picture of what they see) |
| Hand-off | `generate_report` (PDF + BCF, download link), `export_models` (IFC, and STEP for STEP models) |

**Read-only tools.** The tools that change neither the model, the open report nor the allowance declare it
(`readOnlyHint`):
- `get_session`, `list_models`, `report_summary`, `list_clashes`, `get_clash`, `get_clash_images`, `measure_clash`;
- `describe_element`, `find_elements`, `find_openings`, `find_root_causes`;
- `check_move`, `check_offset`, `check_route`, `check_resize`, `check_penetration`, `check_seat`, `get_job`;
- `show_clash`, `set_view`, `set_filters`, `clear_filters`, `capture_view`.

Clients that honour `readOnlyHint` can run those without an approval prompt. The rest ask: proposals, plans, applying,
detection, triage, the report, opening models, and `find_patterns` (a model call, charged once as a proposal).

The tool layer is shared with the in-app chat (`chat.Chat._run`), so the chat and an outside agent can do the same
things the same way.

**How the work runs:**
- **Long work** (a proposal, a plan, triage, the report) runs as a job. A call waits up to `wait_s` (40 s by default).
  If the job isn't done by then, it returns `{job_id, status: "running"}`, and `get_job` waits for the result. This
  keeps clients with short tool timeouts safe.
- **Nothing changes the model until `apply_fix` or `apply_plan`.** Both apply on the server. The page then patches
  the change into the viewer in place (or reloads the changed file when it is behind) and marks the clash fixed,
  exactly as when the person accepts a fix.
- **Pictures:**
  - A Navisworks report carries its own pictures.
  - For a clash Iris found, `get_clash_images` asks the person's page to take the A/B/C views. They are saved on the
    report, where the fix agent, triage and the PDF use them too.
  - `capture_view` asks the page for what it shows now.
  - Without a page, both say so.

## Links and security

- **Capability tokens.** A link is `iris_` + 32 random bytes, shown once, in the dialog. The server keeps only its
  sha256.
- **Lifetime.** A link expires 12 hours after its last use, and 24 hours at most. **Revoke** ends it at once. A
  server restart ends every link (links live in memory, like the scenes they point at).
- **One session per link.** A link carries the visitor's context (scene, report, selected clash, fixed clashes). The
  page keeps it current (`PUT /api/links/{token}/context`), so the agent sees what the person sees.
- **Charges.** Calls are charged to whoever made the link:
  - fixes, plans, triage and the report cost proposals from the demo's allowance, like the person's own;
  - the owner's links have no caps;
  - every link has its own call cap (`IRIS_AGENT_CALLS_PER_HOUR`, 600 on the demo);
  - link creation is capped per visitor (`IRIS_LINKS_PER_HOUR`/`DAY`).
- **What the agent never gets.** It never sees a model credential. Only the server calls Gemini.
- **What `/mcp` refuses.** Without a live token it answers 401 before the MCP layer runs. The transport's DNS-rebinding
  check (meant for servers on localhost) is off, because every request must carry a token.

**On Cloud Run.**
- **One JSON response per call.** `/mcp` runs stateless (`json_response=True`), with no long-held SSE stream, so request timeouts
  and proxy buffering on the hosting platform do not cut it off.
- **The page's stream.** The page follows its link with `GET /api/links/{token}/events`, an NDJSON stream sent
  uncompressed (`Content-Encoding: identity`). It ends every 4 minutes, and the page reconnects.

## When the tab closes

- **The agent keeps working.** The link and the models live on the server, not in the tab. Reading, checking,
  proposing, applying, triage, the report and export all carry on.
- **Only the page tools stop:** `capture_view`, pictures of clashes Iris found, `show_clash`, `set_view` and the filters.
  `get_session` says the page is closed.
- **Resume.** The browser keeps the session (models, report, fixes, link) in `localStorage`. Opening Iris again shows
  "Pick up where you left off" while the server still holds it. **Resume** reopens the same models, with every
  applied fix, the agent's included, and the page follows the link again.
- **Eviction.** The demo keeps 8 model sets in memory. Those that live links point at are evicted last.
- **What ends a session:** a server restart, or eviction when every held set is linked.
- **Time left.** The dialog shows the link's time left, kept current from the server. Each agent call renews it to
  12 hours, never past 24 hours from when it was made.

## Measured (local)

**Remote.** A real MCP client (the `mcp` Python package over Streamable HTTP), with a browser following the same link
on the PC-03 cell:
- `show_clash` #58 moved the person's camera;
- `get_clash_images` had the page take and return A/B/C in 8 s;
- `capture_view` returned the live view;
- `check_move` worked as expected;
- after `apply_fix`, the page reloaded the model and showed "1 fixed";
- `export_models` returned the download link.

**Stdio.** The local server opened the cell from STEP, checked it (107 clashes) and answered the same tools.

## Later

- **Accounts:** GitHub sign-in on top of links, so projects and links survive a restart. Today `owner.cookie_ok`
  becomes "signed in as an allowed login".
- **Saved projects:** persistence in Cloud Storage.
- **OAuth on `/mcp`:** so clients sign in instead of pasting a token (OAuth 2.1 with dynamic client registration,
  which hosted MCP connectors expect).
