import React from 'react';
import { renderMarkdown } from '../lib/markdown';
// Vite `?raw` import: the page always reflects docs/USER_GUIDE.md verbatim,
// so there is one source of truth for the guide's content.
import guideSource from '../docs/USER_GUIDE.md?raw';

/**
 * In-app rendering of docs/USER_GUIDE.md, reachable from the nav bar. Kept
 * in-app (rather than linking out to GitHub) so it's available to field
 * users without external connectivity, consistent with the app's
 * offline-first posture elsewhere (search index, dataStore caching).
 *
 * Images in the guide use paths relative to the app root (e.g.
 * `images/screenshot_main.png`, served from `public/images/`) rather than a
 * leading slash — the app is hash-routed, so the document's own URL never
 * changes between routes and a relative path always resolves correctly, even
 * when the app is deployed under a DHIS2 instance subpath.
 */
export const GuidePage: React.FC = () => (
  <div className="page page--guide">
    <div className="guide">{renderMarkdown(guideSource)}</div>
  </div>
);
