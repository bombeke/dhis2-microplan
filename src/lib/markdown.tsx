import React from 'react';

/**
 * Minimal Markdown → JSX renderer for the in-app user guide. Covers exactly
 * the subset docs/USER_GUIDE.md uses (headings, hr, GFM pipe tables, bullet
 * and numbered lists, bold, inline code, links, images, paragraphs) — not a
 * general CommonMark implementation. Keeping the guide's source of truth as
 * one Markdown file (imported with Vite's `?raw`) avoids a duplicate,
 * drift-prone JSX copy of the same content.
 */

const isSeparatorRow = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());

const splitTableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

let keySeed = 0;

/** Tokenises **bold**, `code`, ![alt](src) images, and [text](url) links inside a line of text. */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={keySeed++}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      nodes.push(<code key={keySeed++}>{m[2]}</code>);
    } else if (m[4] !== undefined) {
      nodes.push(<img key={keySeed++} src={m[4]} alt={m[3]} loading="lazy" />);
    } else {
      nodes.push(
        <a key={keySeed++} href={m[6]} target="_blank" rel="noreferrer">
          {m[5]}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
      blocks.push(<Tag key={keySeed++}>{renderInline(heading[2])}</Tag>);
      i++;
      continue;
    }

    // horizontal rule
    if (/^-{3,}$/.test(line.trim())) {
      blocks.push(<hr key={keySeed++} />);
      i++;
      continue;
    }

    // table: a "| ... |" row immediately followed by a separator row
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <table key={keySeed++}>
          <thead>
            <tr>
              {header.map((h, c) => (
                <th key={c}>{renderInline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, c) => (
                  <td key={c}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // unordered list (bullets may continue on indented following lines)
    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i].trim()) || (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length))) {
        if (/^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        } else {
          items[items.length - 1] += ' ' + lines[i].trim();
        }
        i++;
      }
      blocks.push(
        <ul key={keySeed++}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && (/^\d+\.\s+/.test(lines[i].trim()) || (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length))) {
        if (/^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        } else {
          items[items.length - 1] += ' ' + lines[i].trim();
        }
        i++;
      }
      blocks.push(
        <ol key={keySeed++}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // paragraph: consume until a blank line or a line starting a new block
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^-{3,}$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={keySeed++}>{renderInline(paraLines.join(' '))}</p>);
  }

  return blocks;
}
