import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Input, Markdown, Text, createRoot, makeTheme, useRect, useTerminalColors } from "@zenbu-labs/pixel";
import type { EngineKeyEvent, MarkdownTheme, NodeHandle, ScrollEvent, Theme } from "@zenbu-labs/pixel";
import { listMarkdown } from "./files";
import { highlightMarkdown } from "./highlight";
import type { EditorPalette } from "./highlight";

type View = "split" | "edit" | "preview";
type Pane = "editor" | "preview";
const VIEWS: View[] = ["split", "edit", "preview"];

// bin/tuimark.mjs passes: <absolute file or directory> <view>
const target = path.resolve(process.argv[2] ?? process.cwd());
const startView: View = VIEWS.find((view) => view === process.argv[3]) ?? "split";
const targetIsDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
const ROOT_DIR = targetIsDir ? target : path.dirname(target);
const START_FILES = listMarkdown(ROOT_DIR);
const START_FILE = targetIsDir
  ? path.join(ROOT_DIR, START_FILES.find((file) => /^readme\.md$/i.test(file)) ?? START_FILES[0] ?? "untitled.md")
  : target;

const OPENER = process.platform === "darwin" ? "open" : "xdg-open";
const MONO_FONTS = [
  path.join(os.homedir(), "Library/Fonts/JetBrainsMono-Regular.ttf"),
  "/Library/Fonts/JetBrainsMono-Regular.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Menlo.ttc",
  "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
];

let handleKey: ((event: EngineKeyEvent) => boolean) | null = null;

const root = createRoot({
  name: "tuimark",
  onUnsupportedTerminal: () =>
    "\n  \x1b[1mtuimark needs a terminal with graphics support\x1b[0m (Ghostty/cmux, Kitty, WezTerm, iTerm2, Konsole, Warp)\n\n",
  onKey: (event) => handleKey?.(event) ?? false,
});

const monoFont: Promise<number | undefined> = (async () => {
  for (const file of MONO_FONTS) {
    if (!fs.existsSync(file)) continue;
    try {
      return await root.registerFont(file);
    } catch {
      // Unsupported font container; try the next one.
    }
  }
  return undefined;
})();

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

interface Doc {
  file: string;
  /** Contents on disk as last seen; null when the file doesn't exist yet. */
  disk: string | null;
  /** Bumped whenever the editor must be re-seeded from `disk`. */
  rev: number;
}

interface Notice {
  text: string;
  warn: boolean;
}

function App() {
  const colors = useTerminalColors();
  const theme = useMemo(() => makeTheme(colors), [colors]);
  const rem = root.info.basePx;

  const [doc, setDoc] = useState<Doc>(() => ({ file: START_FILE, disk: readText(START_FILE), rev: 0 }));
  const [text, setText] = useState(doc.disk ?? "");
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState<View>(startView);
  const [sidebar, setSidebar] = useState(targetIsDir && START_FILES.length > 1);
  const [files, setFiles] = useState(START_FILES);
  const [split, setSplit] = useState(0.5);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [diskChanged, setDiskChanged] = useState(false);
  const [mono, setMono] = useState<number>();

  const inputRef = useRef<NodeHandle>(null);
  const editorRef = useRef<NodeHandle>(null);
  const previewRef = useRef<NodeHandle>(null);
  const bodyRef = useRef<NodeHandle>(null);
  const bodyRect = useRect(bodyRef);
  // A pane's max is only known once it has scrolled; 1e9 lets the engine clamp the first sync to the real max.
  const scrolls = useRef<Record<Pane, ScrollEvent>>({ editor: { offset: 0, max: 1e9 }, preview: { offset: 0, max: 1e9 } });
  const leader = useRef<Pane>("editor");
  const syncRatio = useRef<number | null>(null);
  const dragFrom = useRef(0);
  const quitArmed = useRef(false);
  const discardArmed = useRef<string | null>(null);
  const latest = useRef({ doc, text });
  latest.current = { doc, text };

  const dirty = text !== (doc.disk ?? "");
  const relFile = path.relative(ROOT_DIR, doc.file);

  useEffect(() => {
    void monoFont.then(setMono);
  }, []);

  useEffect(() => {
    root.setTitle(`${path.basename(doc.file)}${dirty ? " ●" : ""} — tuimark`);
  }, [doc.file, dirty]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (view === "preview") inputRef.current?.blur();
    else inputRef.current?.focus();
  }, [view, doc.rev]);

  // Follow the file on disk (agents, other editors). Clean buffers reload; dirty ones get a warning.
  useEffect(() => {
    const file = doc.file;
    const onDiskChange = () => {
      const disk = readText(file);
      const { doc: current, text: buffer } = latest.current;
      if (current.file !== file || disk === current.disk) return;
      if (buffer === (current.disk ?? "")) {
        setDoc((d) => ({ ...d, disk, rev: d.rev + 1 }));
        setText(disk ?? "");
        setNotice({ text: disk === null ? "file deleted on disk" : "reloaded from disk", warn: disk === null });
      } else {
        setDiskChanged(true);
      }
    };
    fs.watchFile(file, { interval: 250 }, onDiskChange);
    return () => fs.unwatchFile(file, onDiskChange);
  }, [doc.file]);

  const spans = useMemo(() => {
    const palette: EditorPalette = {
      fg: theme.fg,
      muted: theme.muted,
      accent: theme.accent,
      heading: theme.accent,
      code: theme.magenta,
      codeBg: theme.field,
      quote: theme.green,
      list: theme.yellow,
      task: theme.cyan,
      link: theme.cyan,
      syntax: syntaxColors(theme),
    };
    return highlightMarkdown(text, palette);
  }, [text, theme]);

  const mdTheme = useMemo<MarkdownTheme>(
    () => ({
      fg: theme.fg,
      muted: theme.muted,
      link: theme.accent,
      inlineCode: theme.magenta,
      codeBg: theme.field,
      separator: theme.hairline,
      syntax: syntaxColors(theme),
    }),
    [theme],
  );

  const caret = useMemo(() => {
    const before = Buffer.from(text).subarray(0, cursor).toString();
    const lineStart = before.lastIndexOf("\n") + 1;
    return { line: before.split("\n").length, col: before.length - lineStart + 1 };
  }, [text, cursor]);

  const words = useMemo(() => text.match(/\S+/g)?.length ?? 0, [text]);

  const openFile = (file: string) => {
    if (file === doc.file) return;
    if (dirty && discardArmed.current !== file) {
      discardArmed.current = file;
      setNotice({ text: "unsaved changes — ctrl+s to save, or open again to discard", warn: true });
      return;
    }
    discardArmed.current = null;
    const disk = readText(file);
    setDoc((d) => ({ file, disk, rev: d.rev + 1 }));
    setText(disk ?? "");
    setCursor(0);
    setDiskChanged(false);
    previewRef.current?.scrollTo(0);
    editorRef.current?.scrollTo(0);
  };

  const save = () => {
    try {
      fs.mkdirSync(path.dirname(doc.file), { recursive: true });
      fs.writeFileSync(doc.file, text);
    } catch (error) {
      setNotice({ text: `save failed: ${error instanceof Error ? error.message : String(error)}`, warn: true });
      return;
    }
    setDoc((d) => ({ ...d, disk: text }));
    setDiskChanged(false);
    setNotice({ text: `saved ${relFile}`, warn: false });
    if (!files.includes(relFile)) setFiles(listMarkdown(ROOT_DIR));
  };

  const reload = () => {
    const disk = readText(doc.file);
    setDoc((d) => ({ ...d, disk, rev: d.rev + 1 }));
    setText(disk ?? "");
    setDiskChanged(false);
    setNotice({ text: "reloaded from disk", warn: false });
  };

  const quit = () => {
    if (dirty && !quitArmed.current) {
      quitArmed.current = true;
      setNotice({ text: "unsaved changes — ctrl+q again to quit without saving", warn: true });
      return;
    }
    root.stop();
  };

  const openLink = (href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      execFile(OPENER, [href]);
      return;
    }
    const local = path.resolve(path.dirname(doc.file), decodeURI(href.split("#")[0]));
    if (/\.(md|markdown|mdx)$/i.test(local)) openFile(local);
    else execFile(OPENER, [local]);
  };

  const scrollPreview = (delta: number) => {
    const { offset, max } = scrolls.current.preview;
    previewRef.current?.scrollTo(Math.max(0, Math.min(max, offset + delta)), true);
  };

  // In split view the pane under the pointer leads and the other follows at the same fraction of its
  // scroll range. A follower's first event after a sync carries its fresh max, so it corrects itself once.
  const onPaneScroll = (pane: Pane, event: ScrollEvent) => {
    scrolls.current[pane] = event;
    if (view !== "split") return;
    const other: Pane = pane === "editor" ? "preview" : "editor";
    const otherRef = other === "editor" ? editorRef : previewRef;
    if (pane === leader.current) {
      syncRatio.current = event.max > 0 ? event.offset / event.max : 0;
      otherRef.current?.scrollTo(syncRatio.current * scrolls.current[other].max);
    } else if (syncRatio.current !== null) {
      const want = syncRatio.current * event.max;
      syncRatio.current = null;
      if (Math.abs(event.offset - want) > 1) (pane === "editor" ? editorRef : previewRef).current?.scrollTo(want);
    }
  };

  useEffect(() => {
    handleKey = (event) => {
      if (event.kind === "release") return false;
      if (event.mods.ctrl) {
        if (event.key !== "q" && event.key !== "c") quitArmed.current = false;
        switch (event.key) {
          case "s":
            save();
            return true;
          case "e":
            setView((v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]);
            return true;
          case "t":
            setSidebar((open) => !open);
            setFiles(listMarkdown(ROOT_DIR));
            return true;
          case "r":
            reload();
            return true;
          case "q":
          case "c":
            quit();
            return true;
          case "d":
            if (view !== "preview") return false;
            scrollPreview((bodyRect?.height ?? rem * 20) / 2);
            return true;
          case "u":
            if (view !== "preview") return false;
            scrollPreview(-(bodyRect?.height ?? rem * 20) / 2);
            return true;
        }
        return false;
      }
      // The editor is hidden in preview view, so plain keys drive the reader.
      if (view !== "preview" || event.mods.alt || event.mods.super) return false;
      const page = (bodyRect?.height ?? rem * 20) * 0.9;
      const step: Record<string, number> = {
        j: rem * 2,
        down: rem * 2,
        k: -rem * 2,
        up: -rem * 2,
        space: event.mods.shift ? -page : page,
        pagedown: page,
        pageup: -page,
        g: event.mods.shift ? Infinity : -Infinity,
        home: -Infinity,
        end: Infinity,
      };
      if (event.key in step) {
        scrollPreview(step[event.key]);
        return true;
      }
      if (event.key === "q") {
        quit();
        return true;
      }
      if (event.key === "e" || event.key === "i") {
        setView("edit");
        return true;
      }
      return false;
    };
  });

  const showEditor = view !== "preview";
  const showPreview = view !== "edit";
  const editorPct = view === "split" ? Math.round(split * 1000) / 10 : 100;
  const hint = (keys: string, label: string) => (
    <Text key={keys} style={{ fontSize: rem * 0.8, color: theme.disabled, selectable: false }}>
      {`${keys} ${label}`}
    </Text>
  );

  return (
    <Box style={{ flexDirection: "column", width: "100%", height: "100%", background: theme.bg }}>
      {/* header */}
      <Box
        style={{
          alignItems: "center",
          gap: rem * 0.75,
          padding: { left: rem, right: rem, top: rem * 0.4, bottom: rem * 0.4 },
          border: { bottom: [1, theme.hairline] },
        }}
      >
        <Text style={{ fontSize: rem * 0.85, color: theme.accent, selectable: false }}>tuimark</Text>
        <Text style={{ flexShrink: 1, ellipsis: true, color: theme.fg }}>{relFile}</Text>
        {dirty && <Text style={{ color: theme.yellow, selectable: false }}>●</Text>}
        {doc.disk === null && <Text style={{ fontSize: rem * 0.8, color: theme.muted }}>new file</Text>}
        {diskChanged && (
          <Text style={{ fontSize: rem * 0.8, color: theme.red }} onClick={reload}>
            changed on disk — ctrl+r to reload
          </Text>
        )}
        <Box style={{ flexGrow: 1 }} />
        <Box style={{ gap: rem * 0.25 }}>
          {VIEWS.map((v) => (
            <Box
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: { left: rem * 0.5, right: rem * 0.5, top: rem * 0.1, bottom: rem * 0.1 },
                cornerRadius: rem * 0.3,
                background: v === view ? theme.hoverStrong : undefined,
                hoverBackground: theme.hover,
                pointerShape: "pointer",
              }}
            >
              <Text style={{ fontSize: rem * 0.8, color: v === view ? theme.fg : theme.muted, selectable: false }}>{v}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* body */}
      <Box style={{ flexGrow: 1, flexBasis: 0, alignItems: "stretch", overflow: "hidden" }}>
        {sidebar && (
          <Box
            style={{
              flexDirection: "column",
              width: rem * 16,
              flexShrink: 0,
              overflow: "scroll",
              padding: { top: rem * 0.5, bottom: rem * 0.5 },
              border: { right: [1, theme.hairline] },
            }}
          >
            <Text style={{ fontSize: rem * 0.75, color: theme.disabled, padding: { left: rem * 0.75, bottom: rem * 0.3 }, ellipsis: true }}>
              {`${files.length} files · ${ROOT_DIR.replace(os.homedir(), "~")}`}
            </Text>
            {files.map((file) => {
              const full = path.join(ROOT_DIR, file);
              const dir = path.dirname(file);
              const active = full === doc.file;
              return (
                <Box
                  key={file}
                  onClick={() => openFile(full)}
                  style={{
                    flexDirection: "column",
                    padding: { left: rem * 0.75, right: rem * 0.5, top: rem * 0.15, bottom: rem * 0.15 },
                    background: active ? theme.hoverStrong : undefined,
                    hoverBackground: theme.hover,
                    pointerShape: "pointer",
                  }}
                >
                  <Text style={{ fontSize: rem * 0.85, color: active ? theme.fg : theme.muted, ellipsis: true, selectable: false }}>
                    {path.basename(file)}
                  </Text>
                  {dir !== "." && (
                    <Text style={{ fontSize: rem * 0.7, color: theme.disabled, ellipsis: true, selectable: false }}>{dir}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        <Box ref={bodyRef} style={{ flexGrow: 1, flexBasis: 0, alignItems: "stretch" }}>
          <Box
            ref={editorRef}
            hidden={!showEditor}
            onScroll={(event) => onPaneScroll("editor", event)}
            onMouseEnter={() => (leader.current = "editor")}
            style={{ width: `${editorPct}%`, flexShrink: 0, flexDirection: "column", alignItems: "stretch", overflow: "scroll" }}
          >
            <Input
              key={`${doc.file}\0${doc.rev}`}
              ref={inputRef}
              defaultValue={text}
              autoFocus={showEditor}
              spans={spans}
              gutter={{ color: theme.disabled, activeColor: theme.muted }}
              activeLine={theme.field}
              caretColor={theme.accent}
              selectionColor={theme.selection}
              onChange={(value, change) => {
                quitArmed.current = false;
                setText(value);
                setCursor(change.cursor);
              }}
              onCaret={(info) => setCursor(info.cursor)}
              style={{
                flexGrow: 1,
                font: mono,
                fontSize: rem * 0.95,
                color: theme.fg,
                padding: { left: rem * 0.25, right: rem * 0.75, top: rem * 0.5, bottom: rem * 0.5 },
              }}
            />
          </Box>

          {view === "split" && (
            <Box
              onDrag={(event) => {
                if (event.phase === "start") dragFrom.current = event.x;
                else if (bodyRect && bodyRect.width > 0) {
                  const delta = (event.x - dragFrom.current) / bodyRect.width;
                  setSplit((s) => Math.max(0.2, Math.min(0.8, s + delta)));
                }
              }}
              style={{ width: rem * 0.6, flexShrink: 0, justifyContent: "center", alignItems: "stretch", pointerShape: "ew-resize" }}
            >
              <Box style={{ width: 1, background: theme.hairline }} />
            </Box>
          )}

          <Box
            ref={previewRef}
            hidden={!showPreview}
            onScroll={(event) => onPaneScroll("preview", event)}
            onMouseEnter={() => (leader.current = "preview")}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              flexDirection: "column",
              alignItems: "center",
              overflow: "scroll",
              padding: { left: rem * 1.25, right: rem * 1.25, top: rem, bottom: rem * 2 },
            }}
          >
            <Box style={{ flexDirection: "column", width: "100%", maxWidth: rem * 56 }}>
              {text.trim() === "" ? (
                <Text style={{ color: theme.disabled }}>{doc.disk === null ? "Empty new file — start typing." : "Empty file."}</Text>
              ) : (
                <Markdown
                  text={text}
                  theme={mdTheme}
                  rem={rem}
                  monoFont={mono}
                  onLinkClick={openLink}
                  highlight={view === "split" ? { start: cursor, end: cursor + 1 } : null}
                  highlightBg={theme.hover}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* status bar */}
      <Box
        style={{
          alignItems: "center",
          gap: rem * 0.9,
          padding: { left: rem, right: rem, top: rem * 0.3, bottom: rem * 0.3 },
          border: { top: [1, theme.hairline] },
        }}
      >
        {notice ? (
          <Text style={{ fontSize: rem * 0.8, color: notice.warn ? theme.yellow : theme.green, flexShrink: 1, ellipsis: true }}>
            {notice.text}
          </Text>
        ) : (
          <Text style={{ fontSize: rem * 0.8, color: theme.muted, selectable: false }}>
            {view === "preview" ? `${words} words` : `Ln ${caret.line}, Col ${caret.col} · ${words} words`}
          </Text>
        )}
        <Box style={{ flexGrow: 1 }} />
        {view === "preview" ? [hint("j/k space", "scroll"), hint("e", "edit")] : null}
        {hint("^S", "save")}
        {hint("^E", "view")}
        {hint("^T", "files")}
        {hint("^R", "reload")}
        {hint("^Q", "quit")}
      </Box>
    </Box>
  );
}

/** Tree-sitter capture → terminal palette colour, shared by editor fences and preview code blocks. */
function syntaxColors(theme: Theme): MarkdownTheme["syntax"] {
  return {
    keyword: theme.magenta,
    string: theme.green,
    comment: theme.muted,
    number: theme.yellow,
    constant: theme.yellow,
    function: theme.accent,
    type: theme.cyan,
    constructor: theme.cyan,
    tag: theme.red,
    attribute: theme.yellow,
    escape: theme.cyan,
    property: theme.fg,
    operator: theme.muted,
    punctuation: theme.muted,
    variable: theme.fg,
    embedded: theme.fg,
  };
}

root.render(<App />);
