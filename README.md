# tuimark

A markdown editor with a live rendered preview, running inside your terminal. Built on
[pixel](https://github.com/zenbu-labs/terminal-browser/tree/main/pixel), so the preview gets real
headings, proportional text, tables, and syntax-highlighted code blocks instead of ANSI
approximations.

It's designed to sit beside a coding agent: run it in a [herdr](https://herdr.dev) or tmux pane,
or let [omp](https://github.com/can1357/oh-my-pi) open it for you. Agents edit the file on disk
and the pane follows along.

## Features

- **Split editor + preview.** The source side has syntax highlighting (markdown and fenced code).
  The preview highlights the block under your caret and scrolls to it.
- **Three views:** `split`, `edit`, and `preview`. Preview is a read-only reader with
  `j`/`k`/`space`/`g`/`G` scrolling.
- **Live reload.** When the file changes on disk, a clean buffer reloads itself. A buffer with
  unsaved edits shows a "changed on disk" warning instead of being overwritten.
- **File sidebar.** Open a directory and you get every markdown file under it (respects
  `.gitignore` inside git repos), with `README.md` opened first.
- **Links.** Relative `.md` links open in tuimark. Other links go to your default browser
  or app.
- **Safe quitting.** If you have unsaved changes, quitting asks twice.

## Requirements

- A terminal with kitty-graphics support: Ghostty (and cmux), Kitty, WezTerm, iTerm2, Konsole, or
  Warp. herdr and tmux work as multiplexers on top of these.
- Node.js ≥ 20, on macOS or Linux.

**herdr:** use herdr 0.9.2 or newer (`herdr update`, run outside herdr after detaching). Older
versions either leave the pane blank or ghost: herdr before 0.9.0 replaces images one row at a
time, so rows of old frames stay on screen. 0.9.x draws pixel's standard kitty graphics directly
and turns graphics on by default. If you upgrade, or change `kitty_graphics` in
`~/.config/herdr/config.toml`, detach (`ctrl+b q` by default) and run `herdr` again.

## Install

```sh
git clone https://github.com/ucalyptus/tuimark
cd tuimark
npm install            # also downloads pixel's patched Electron runtime and builds dist/
npm link               # or: ln -s "$PWD/bin/tuimark.mjs" ~/.local/bin/tuimark
```

If `npm install` skipped install scripts, run
`node node_modules/@zenbu-labs/pixel/scripts/postinstall.mjs`.

## Usage

```sh
tuimark                     # browse markdown in the current directory
tuimark notes/              # browse a directory
tuimark PLAN.md             # open a file (created on first save if missing)
tuimark PLAN.md -p          # start in the read-only preview
tuimark --view edit file.md
```

| Key | Action |
| --- | --- |
| `ctrl+s` | save |
| `ctrl+e` | cycle view: split → edit → preview |
| `ctrl+t` | toggle the file sidebar |
| `ctrl+r` | reload from disk, discarding edits |
| `ctrl+q` / `ctrl+c` | quit (press twice with unsaved changes) |
| `j` `k` `space` `g` `G` `ctrl+d` `ctrl+u` | scroll (preview view) |
| `e` / `i` | switch from preview to the editor |
| `q` | quit (preview view) |

You can also drag the divider between editor and preview to resize them.

## omp + herdr

tuimark comes with an [omp](https://github.com/can1357/oh-my-pi) extension. It works the way
diffr's does: omp opens tuimark in a herdr (or tmux) pane next to itself, and the pane closes
when tuimark quits.

```sh
tuimark install-omp     # copies omp/tuimark.ts to ~/.omp/agent/extensions/; restart omp
tuimark uninstall-omp
```

The extension adds:

- **`/tuimark [path] [--view split|edit|preview]`**, a slash command that opens the pane and
  focuses it.
- **`tuimark_open`**, a tool the agent calls to show you a document it wrote (a plan, a README,
  notes). It opens without taking focus so it won't interrupt your typing. Because of live
  reload, you see each edit the agent makes after that.

omp has to be running inside herdr or tmux for this to work.

## Agent skill

`skills/tuimark/SKILL.md` is an agent skill. It tells a coding agent how to open tuimark next
to itself (omp tool, herdr, tmux, or cmux), how to avoid overwriting your unsaved edits, and how
to fix blank or ghosting panes. Link it into your agent's skills directory:

```sh
ln -s "$PWD/skills/tuimark" ~/.agents/skills/tuimark    # or ~/.claude/skills/tuimark
```

## How it works

`bin/tuimark.mjs` checks the arguments in the plain terminal. It then runs `pixel`, which starts
`dist/main.js` inside pixel's Electron runtime, and the UI is drawn with the kitty graphics
protocol. Pixel provides the editor (`Input`), the preview (`Markdown`), and code highlighting
(tree-sitter `highlight`). tuimark only adds the markdown source highlighter
(`src/highlight.ts`), file discovery (`src/files.ts`), and the app shell (`src/main.tsx`).

Inspired by [mdmux](https://github.com/nero408/mdmux). mdmux sends rendering to cmux's markdown
panel. tuimark renders in-process with pixel, so it works in any graphics terminal, inside or
outside cmux.

## License

MIT
