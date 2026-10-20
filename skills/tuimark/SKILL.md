---
name: tuimark
description: Opens markdown files in tuimark, a pixel-based terminal editor with live rendered preview, in a pane next to the agent (omp tool, herdr, tmux, or cmux), and fixes blank, ghosting, or stuck tuimark panes. Use when the user mentions tuimark, asks to view, preview, review, or edit a markdown file (plan, README, notes, CLAUDE.md) in the terminal, or wants a document rendered beside the agent instead of pasted into chat.
---

# tuimark

`tuimark [path] [--view split|edit|preview | -p | -e]`. `path` is a markdown file (created on first
save if it doesn't exist) or a directory to browse. It needs a graphics terminal (Ghostty/cmux,
Kitty, WezTerm, iTerm2) and herdr ≥ 0.9.2 when running inside herdr. Source:
https://github.com/ucalyptus/tuimark

## Open it beside the agent

Pass an absolute path. Use `--view preview` when the user should read the file, and the default
`split` view when they'll edit it. Launch with `exec` so the pane closes when tuimark quits.

1. **omp with the extension** (`tuimark install-omp`, then restart omp): call the `tuimark_open`
   tool with `{ "path": "...", "view": "preview" }`, or have the user run `/tuimark path`.
2. **herdr** (`test "$HERDR_ENV" = 1`):
   ```bash
   P=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | jq -r .result.pane.pane_id)
   herdr pane run "$P" "exec tuimark /abs/path/PLAN.md --view preview"
   ```
   Add `herdr pane focus --current --direction right` only if the user wants to type into it now.
3. **tmux**: `tmux split-window -h -d "tuimark /abs/path/PLAN.md -p"`
4. **cmux without herdr**: run `cmux new-split right --focus false`, take the surface ref it
   prints, then `cmux send --surface <ref> 'exec tuimark /abs/path/PLAN.md -p\n'`.

## Working with an open pane

- **Live reload.** tuimark watches the file. After you write the file, the pane re-renders on its
  own. Don't reopen it.
- **Unsaved edits.** The terminal title is `<file> — tuimark` when the buffer is clean and
  `<file> ● — tuimark` when the user has unsaved edits. In herdr, read it with
  `herdr pane get <pane> | jq -r .result.pane.terminal_title`. While the `●` is there, don't write
  the file: tuimark keeps the user's buffer and shows "changed on disk", so your change is
  invisible until they press `ctrl+r`, and `ctrl+r` throws away their edits. Ask them to save first.
- **Closing.** On a clean buffer, `herdr pane send-keys <pane> ctrl+q` quits, and `exec` closes the
  pane. With unsaved edits, the first `ctrl+q` only warns and the second one discards the edits.
  Never send the second press without the user's say-so.
- **What you can't see.** The UI is drawn as kitty graphics, so `herdr pane read` and
  `cmux read-screen` return nothing useful. To check that it's running, use the title or
  `pgrep -f tuimark`. For how it looks, ask the user for a screenshot.

## Keys (for telling the user)

`ctrl+s` save · `ctrl+e` cycle split/edit/preview · `ctrl+t` file sidebar · `ctrl+r` reload from
disk · `ctrl+q` quit · preview view: `j`/`k`/`space`/`g`/`G` scroll, `e` edit, `q` quit · drag the
divider to resize.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pane is blank, title is set | herdr client attached before graphics were on; `pane.graphics.info` says `cell_size_unavailable` | User detaches (`ctrl+b q`) and runs `herdr` again |
| Text ghosts or overlaps after edits | herdr < 0.9.0 replaces images one row at a time | User detaches and runs `herdr update --handoff`, then `herdr`. This can't be run from inside herdr. Restart tuimark afterwards |
| `the patched electron build is not installed` | pixel's postinstall was skipped | `node node_modules/@zenbu-labs/pixel/scripts/postinstall.mjs` in the tuimark checkout |
| Shell prints `…13u` / `;1:1C` after tuimark exits | kitty keyboard mode was left on | `printf '\033[<u' > /dev/$(ps -o tty= -p <shell pid>)`, then `herdr pane send-keys <pane> ctrl+u` |
| `dist/main.js is missing` | not built | `npm run build` in the tuimark checkout |

Runtime log: `~/.local/state/pixel/logs/tuimark.stderr.log`.
