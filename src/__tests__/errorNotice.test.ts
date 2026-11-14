import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorNotice } from '../components/ErrorNotice';

const render = (error: Parameters<typeof ErrorNotice>[0]['error']) =>
  renderToStaticMarkup(React.createElement(ErrorNotice, { error, onClose: () => undefined }));

describe('ErrorNotice', () => {
  it('renders nothing when there is no error', () => {
    expect(render(null)).toBe('');
  });

  it('is an inline alert with the title, the message, the hints and a dismiss button', () => {
    const html = render({
      title: 'No valid route found',
      message: 'Could not build a valid Touch & Go route to EPKZ.',
      hints: ['Click Generate again.', 'Try another airfield.'],
    });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('aria-modal');
    expect(html).toContain('No valid route found');
    expect(html).toContain('Click Generate again.');
    expect(html).toContain('Try another airfield.');
    expect(html).toContain('aria-label="Dismiss message"');
    expect(html).not.toContain('Detail:');
  });

  it('shows technical detail only when given, and escapes message text', () => {
    const html = render({ title: 'T', message: '<script>alert(1)</script>', detail: 'boom' });
    expect(html).toContain('Detail: boom');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
