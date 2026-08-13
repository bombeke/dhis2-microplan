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
 */
export const GuidePage: React.FC = () => (
  <div className="page page--guide">
    <div className="guide">{renderMarkdown(guideSource)}</div>
  </div>
);
