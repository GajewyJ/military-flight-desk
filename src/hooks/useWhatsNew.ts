import { useCallback, useEffect, useState } from 'react';
import {
  APP_VERSION,
  fetchReleaseNotes,
  readLastSeenVersion,
  shouldShowChangelog,
  writeLastSeenVersion,
  type ReleaseNotes,
} from '../utils/changelog';

export type WhatsNewState =
  | { open: false }
  | { open: true; loading: true }
  | { open: true; loading: false; notes: ReleaseNotes | null; offline: boolean };

/**
 * Release notes of the running version, loaded from GitHub.
 * - On start-up they are shown once after an update (and once on a first install).
 * - openManually() shows them again on request, e.g. from the version label in the header.
 */
export function useWhatsNew() {
  const [state, setState] = useState<WhatsNewState>({ open: false });

  useEffect(() => {
    if (!shouldShowChangelog(readLastSeenVersion(), APP_VERSION)) return;
    let cancelled = false;
    // Wait a little so the notes never compete with the start-up of the app.
    const timer = setTimeout(() => {
      fetchReleaseNotes(APP_VERSION).then((result) => {
        if (cancelled) return;
        if (result.status === 'ok') {
          setState({ open: true, loading: false, notes: result.notes, offline: false });
        } else if (result.status === 'none') {
          writeLastSeenVersion(APP_VERSION); // nothing to show for this version
        }
        // 'error': stay silent and try again the next time the app starts
      });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const openManually = useCallback(() => {
    setState({ open: true, loading: true });
    fetchReleaseNotes(APP_VERSION).then((result) => {
      setState({
        open: true,
        loading: false,
        notes: result.status === 'ok' ? result.notes : null,
        offline: result.status === 'error',
      });
    });
  }, []);

  const close = useCallback(() => {
    writeLastSeenVersion(APP_VERSION);
    setState({ open: false });
  }, []);

  return { state, openManually, close };
}
