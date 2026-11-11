import { describe, it, expect } from 'vitest';
import {
  APP_VERSION,
  compareVersions,
  fetchReleaseNotes,
  parseInline,
  parseReleaseMarkdown,
  shouldShowChangelog,
} from '../utils/changelog';

function fakeResponse(status: number, json?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response;
}

describe('versions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.3.0', '0.2.1')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.5')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.1', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('reads the app version from package.json at build time', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('shows the notes after an update and on first start, not again for the same version', () => {
    expect(shouldShowChangelog('0.2.1', '0.3.0')).toBe(true);
    expect(shouldShowChangelog(null, '0.3.0')).toBe(true);
    expect(shouldShowChangelog('0.3.0', '0.3.0')).toBe(false);
    expect(shouldShowChangelog('0.4.0', '0.3.0')).toBe(false); // downgrade
  });
});

describe('release notes from GitHub', () => {
  it('returns the notes of the release tagged with the version', async () => {
    let requested = '';
    const result = await fetchReleaseNotes('0.3.0', async (url) => {
      requested = url;
      return fakeResponse(200, {
        name: 'Military Flight Desk v0.3.0 (Windows)',
        body: '## Changes\n- one\n- two',
        html_url: 'https://github.com/GajewyJ/military-flight-desk/releases/tag/v0.3.0',
      });
    });
    expect(requested).toContain('/releases/tags/v0.3.0');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.notes.version).toBe('0.3.0');
      expect(result.notes.title).toContain('v0.3.0');
      expect(result.notes.url.startsWith('https://github.com/')).toBe(true);
    }
  });

  it('ignores a release link that does not point to github.com', async () => {
    const result = await fetchReleaseNotes('0.3.0', async () =>
      fakeResponse(200, { name: 'x', body: 'notes', html_url: 'https://evil.example/x' })
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.notes.url).toContain('https://github.com/GajewyJ/');
  });

  it('treats a missing release or empty notes as nothing to show', async () => {
    expect((await fetchReleaseNotes('9.9.9', async () => fakeResponse(404))).status).toBe('none');
    expect((await fetchReleaseNotes('0.3.0', async () => fakeResponse(200, { body: '   ' }))).status).toBe('none');
  });

  it('reports network problems and rate limits as errors so the app can retry later', async () => {
    expect((await fetchReleaseNotes('0.3.0', async () => fakeResponse(403))).status).toBe('error');
    expect((await fetchReleaseNotes('0.3.0', async () => fakeResponse(500))).status).toBe('error');
    expect(
      (
        await fetchReleaseNotes('0.3.0', async () => {
          throw new Error('offline');
        })
      ).status
    ).toBe('error');
  });
});

describe('release notes markdown', () => {
  it('turns headings, bullets and paragraphs into blocks', () => {
    const blocks = parseReleaseMarkdown(
      '**Intro line**\n\n## Recovery\n- Jets fly the break\n- Civil fields: straight-in\n  more detail\n\n---\n\nThe end\r\n'
    );
    expect(blocks.map((b) => b.type)).toEqual(['p', 'heading', 'list', 'p']);
    const list = blocks[2];
    if (list.type === 'list') {
      expect(list.items.length).toBe(2);
      expect(list.items[1]).toContain('more detail');
    }
  });

  it('drops html comments and images', () => {
    const blocks = parseReleaseMarkdown('<!-- hidden -->\n![shot](https://x/y.png)\nText');
    expect(blocks.length).toBe(1);
  });

  it('parses bold, code and https links, and leaves other links as plain text', () => {
    const segs = parseInline('**Bold** and `code` and [site](https://github.com/a/b) and [bad](javascript:alert(1))');
    expect(segs.some((s) => s.bold && s.text === 'Bold')).toBe(true);
    expect(segs.some((s) => s.code && s.text === 'code')).toBe(true);
    expect(segs.some((s) => s.href === 'https://github.com/a/b')).toBe(true);
    expect(segs.some((s) => s.href && s.href.startsWith('javascript'))).toBe(false);
  });
});
