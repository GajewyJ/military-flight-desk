import { fetchWithTimeout } from './http';

/** GitHub repository whose releases hold the release notes (same repo the auto-updater uses). */
export const RELEASES_REPO = 'GajewyJ/military-flight-desk';

/** Version of the running app, taken from package.json at build time. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

const LAST_SEEN_KEY = 'mfd.lastSeenVersion';
const MAX_BODY_CHARS = 20000;

// ---------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------

/** Compares dotted versions such as 0.3.0 and v0.10.1. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * True when the release notes should pop up on start-up: the app has not shown notes for this
 * version yet. With no stored version (first start of an app that has this feature, or a fresh
 * install) the notes are shown once too, since an update from an older build cannot be told
 * apart from a new install.
 */
export function shouldShowChangelog(lastSeen: string | null, current: string): boolean {
  if (!lastSeen) return true;
  return compareVersions(current, lastSeen) > 0;
}

export function readLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeenVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    // storage unavailable: the notes may show again next start, which is harmless
  }
}

// ---------------------------------------------------------------------------------------------
// GitHub release notes
// ---------------------------------------------------------------------------------------------

export interface ReleaseNotes {
  version: string;
  title: string;
  body: string;
  url: string;
}

export type ReleaseNotesResult =
  | { status: 'ok'; notes: ReleaseNotes }
  | { status: 'none' } // no release or no notes for this version: nothing to show
  | { status: 'error' }; // network or rate-limit problem: try again later

type Fetcher = (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;

/** Loads the notes of the GitHub release tagged v<version>. */
export async function fetchReleaseNotes(
  version: string,
  fetcher: Fetcher = fetchWithTimeout
): Promise<ReleaseNotesResult> {
  const tag = `v${version.replace(/^v/i, '')}`;
  const apiUrl = `https://api.github.com/repos/${RELEASES_REPO}/releases/tags/${tag}`;
  try {
    const res = await fetcher(apiUrl, { headers: { Accept: 'application/vnd.github+json' } }, 8000);
    if (res.status === 404) return { status: 'none' };
    if (!res.ok) return { status: 'error' };
    const data = (await res.json()) as { name?: unknown; body?: unknown; html_url?: unknown };
    const body = typeof data.body === 'string' ? data.body.trim().slice(0, MAX_BODY_CHARS) : '';
    if (!body) return { status: 'none' };
    const htmlUrl = typeof data.html_url === 'string' ? data.html_url : '';
    const fallbackUrl = `https://github.com/${RELEASES_REPO}/releases/tag/${tag}`;
    return {
      status: 'ok',
      notes: {
        version: tag.slice(1),
        title: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : `Version ${tag.slice(1)}`,
        body,
        url: htmlUrl.startsWith('https://github.com/') ? htmlUrl : fallbackUrl,
      },
    };
  } catch {
    return { status: 'error' };
  }
}

// ---------------------------------------------------------------------------------------------
// Minimal markdown (headings, bullet lists, paragraphs, bold, code, https links)
// ---------------------------------------------------------------------------------------------

export type NotesBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'p'; text: string };

export interface InlineSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
  href?: string;
}

export function parseReleaseMarkdown(markdown: string): NotesBlock[] {
  const cleaned = markdown.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const blocks: NotesBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.length > 0) blocks.push({ type: 'list', items: list });
    list = null;
  };

  for (const raw of cleaned.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line) || /^\s*!\[/.test(line)) continue; // rules, images
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].replace(/\s*#+\s*$/, '') });
      continue;
    }
    const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (item) {
      flushParagraph();
      if (!list) list = [];
      list.push(item[1]);
      continue;
    }
    const text = line.replace(/^\s*>\s?/, '').trim();
    if (list && /^\s{2,}/.test(raw)) {
      // continuation of the previous bullet
      list[list.length - 1] += ` ${text}`;
      continue;
    }
    flushList();
    paragraph.push(text);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) segments.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) segments.push({ text: m[2], code: true });
    else segments.push({ text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
