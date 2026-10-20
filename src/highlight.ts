import { highlight, HIGHLIGHT_CAPTURES } from "@zenbu-labs/pixel";
import type { Color, TextSpan } from "@zenbu-labs/pixel";

// Input spans and parseMarkdown/highlight offsets are UTF-8 byte offsets.

export interface EditorPalette {
  fg: Color;
  muted: Color;
  accent: Color;
  heading: Color;
  code: Color;
  codeBg: Color;
  quote: Color;
  list: Color;
  task: Color;
  link: Color;
  syntax: Record<string, Color | undefined>;
}

type Style = Omit<TextSpan, "start" | "end">;

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+#-]*)/;
const HEADING = /^(\s{0,3}#{1,6})(\s+)(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^(\s*>[\s>]*)/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s)?/;

// Ordered by priority: earlier patterns claim their range first.
const INLINE: { re: RegExp; style: (p: EditorPalette, m: RegExpExecArray) => [number, number, Style][] }[] = [
  {
    re: /(`+)(?!`)(.+?)(?<!`)\1(?!`)/g,
    style: (p, m) => [[0, m[0].length, { color: p.code, background: p.codeBg }]],
  },
  {
    re: /(!?\[)([^\]\n]*)(\]\()([^)\s]*)((?:\s+"[^"]*")?\))/g,
    style: (p, m) => {
      const a = m[1].length;
      const b = a + m[2].length;
      const c = b + m[3].length;
      const d = c + m[4].length;
      return [
        [0, a, { color: p.muted }],
        [a, b, { color: p.link, underline: true }],
        [b, c, { color: p.muted }],
        [c, d, { color: p.muted, italic: true }],
        [d, m[0].length, { color: p.muted }],
      ];
    },
  },
  {
    re: /<(https?:\/\/[^>\s]+|[^@>\s]+@[^>\s]+)>|\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g,
    style: (p, m) => [[0, m[0].length, { color: p.link, underline: true }]],
  },
  {
    re: /(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1/g,
    style: (p, m) => [[0, m[0].length, { color: p.fg, bold: true, italic: true }]],
  },
  {
    re: /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g,
    style: (p, m) => [[0, m[0].length, { color: p.fg, bold: true }]],
  },
  {
    re: /(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=\S)\*(?!\*)|(?<![_\w])_(?=[^\s_])([^_\n]+?)(?<=\S)_(?![_\w])/g,
    style: (p, m) => [[0, m[0].length, { color: p.fg, italic: true }]],
  },
  {
    re: /~~(?=\S)(.+?)(?<=\S)~~/g,
    style: (p, m) => [[0, m[0].length, { color: p.muted, strikethrough: true }]],
  },
  {
    re: /<\/?[A-Za-z][\w-]*(\s[^<>]*)?\/?>/g,
    style: (p, m) => [[0, m[0].length, { color: p.syntax.tag ?? p.accent }]],
  },
];

class LineSpans {
  readonly claimed: [number, number][] = [];
  constructor(
    private readonly line: string,
    private readonly base: number,
    private readonly out: TextSpan[],
  ) {}

  add(start: number, end: number, style: Style) {
    if (end <= start) return;
    this.claimed.push([start, end]);
    const startByte = this.base + Buffer.byteLength(this.line.slice(0, start));
    const endByte = startByte + Buffer.byteLength(this.line.slice(start, end));
    this.out.push({ start: startByte, end: endByte, ...style });
  }
}

function inline(line: string, from: number, spans: LineSpans, p: EditorPalette) {
  const rest = line.slice(from);
  for (const { re, style } of INLINE) {
    re.lastIndex = 0;
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (spans.claimed.some(([a, b]) => end > a && start < b)) continue;
      for (const [a, b, s] of style(p, m)) spans.add(start + a, start + b, s);
    }
  }
}

function codeBody(body: string, lang: string, base: number, out: TextSpan[], p: EditorPalette) {
  if (!body || !lang) return;
  for (const s of highlight(body, lang)) {
    const color = p.syntax[HIGHLIGHT_CAPTURES[s.capture]];
    if (color) out.push({ start: base + s.start, end: base + s.end, color });
  }
}

export function highlightMarkdown(text: string, p: EditorPalette): TextSpan[] {
  const out: TextSpan[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { marker: string; lang: string; bodyStart: number; body: string[] } | null = null;

  for (const line of lines) {
    const bytes = Buffer.byteLength(line);
    const spans = new LineSpans(line, offset, out);
    const fenceMatch = FENCE.exec(line);

    if (fence) {
      const closes =
        fenceMatch && fenceMatch[2][0] === fence.marker[0] && fenceMatch[2].length >= fence.marker.length && !fenceMatch[3];
      if (closes) {
        codeBody(fence.body.join("\n"), fence.lang, fence.bodyStart, out, p);
        spans.add(0, line.length, { color: p.muted });
        fence = null;
      } else {
        fence.body.push(line);
      }
    } else if (fenceMatch) {
      fence = { marker: fenceMatch[2], lang: fenceMatch[3], bodyStart: offset + bytes + 1, body: [] };
      const markerEnd = fenceMatch[1].length + fenceMatch[2].length;
      spans.add(0, markerEnd, { color: p.muted });
      spans.add(markerEnd, line.length, { color: p.accent, italic: true });
    } else {
      highlightLine(line, spans, p);
    }

    offset += bytes + 1;
  }

  // Unclosed fence: still colour what's been typed so far.
  if (fence) codeBody(fence.body.join("\n"), fence.lang, fence.bodyStart, out, p);
  return out;
}

function highlightLine(line: string, spans: LineSpans, p: EditorPalette) {
  if (RULE.test(line)) {
    spans.add(0, line.length, { color: p.muted });
    return;
  }

  let at = 0;
  const quote = QUOTE.exec(line);
  if (quote) {
    spans.add(0, quote[1].length, { color: p.quote, bold: true });
    at = quote[1].length;
  }

  const rest = line.slice(at);
  const heading = HEADING.exec(rest);
  if (heading) {
    const marker = at + heading[1].length + heading[2].length;
    spans.add(at, marker, { color: p.muted });
    spans.add(marker, line.length, { color: p.heading, bold: true });
    return;
  }

  const list = LIST.exec(rest);
  if (list) {
    const markerStart = at + list[1].length;
    const markerEnd = markerStart + list[2].length;
    spans.add(markerStart, markerEnd, { color: p.list, bold: true });
    at = markerEnd + list[3].length;
    if (list[4]) {
      spans.add(at, at + 3, { color: p.task, bold: true });
      at += list[4].length;
    }
  }

  if (/^\s*\|/.test(rest)) {
    if (/^[\s|:-]+$/.test(rest)) {
      spans.add(at, line.length, { color: p.muted });
      return;
    }
    for (let i = line.indexOf("|", at); i >= 0; i = line.indexOf("|", i + 1)) {
      spans.add(i, i + 1, { color: p.muted });
    }
  }

  inline(line, at, spans, p);
}
