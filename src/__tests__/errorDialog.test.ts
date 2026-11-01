import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorDialog } from '../components/ErrorDialog';

const render = (error: Parameters<typeof ErrorDialog>[0]['error']) =>
  renderToStaticMarkup(React.createElement(ErrorDialog, { error, onClose: () => undefined }));

describe('ErrorDialog', () => {
  it('renders nothing when there is no error', () => {
    expect(render(null)).toBe('');
  });

  it('is an alert dialog above the map, with title, message, hints and an OK button', () => {
    const html = render({
      title: 'No valid route found',
      message: 'Could not build a valid Touch & Go route to EPKZ.',
      hints: ['Click Generate again.', 'Try another airfield.'],
    });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('z-[1000]');
    expect(html).toContain('No valid route found');
    expect(html).toContain('Click Generate again.');
    expect(html).toContain('What to try');
    expect(html).toContain('>OK<');
    expect(html).not.toContain('Technical detail');
  });

  it('shows technical detail only when given, and escapes message text', () => {
    const html = render({ title: 'T', message: '<script>alert(1)</script>', detail: 'boom' });
    expect(html).toContain('Technical detail: boom');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
