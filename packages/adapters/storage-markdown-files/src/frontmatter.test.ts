// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it } from 'vitest';
import {
  editFrontMatter,
  locateFrontMatter,
  parseFrontMatter,
  serialiseField,
  withEol,
} from './frontmatter.js';

const doc = [
  '---',
  '# a comment',
  'id: 01M1E34QM03WVTE8T1RYS3AM18',
  "title:   'Quoted   title'   # trailing",
  'tags:',
  '  [',
  '    one,',
  '    two,',
  '  ]',
  'x-foreign: {a: 1}',
  '---',
  '',
  'Body.',
  '',
].join('\n');

describe('locateFrontMatter', () => {
  it('finds the block and the body in LF files', () => {
    const s = locateFrontMatter(doc);
    expect(doc.slice(s.fmStart, s.fmEnd).startsWith('# a comment')).toBe(true);
    expect(doc.slice(s.bodyStart)).toBe('\nBody.\n');
    expect(s.eol).toBe('\n');
  });

  it('detects CRLF files and a byte-order mark', () => {
    const text = '﻿---\r\nid: x\r\n---\r\n\r\nBody\r\n';
    const s = locateFrontMatter(text);
    expect(s.eol).toBe('\r\n');
    expect(text.slice(s.fmStart, s.fmEnd)).toBe('id: x');
    expect(text.slice(s.bodyStart)).toBe('\r\nBody\r\n');
  });

  it('accepts an empty block and a closing fence at the end of the file', () => {
    expect(locateFrontMatter('---\n---\nBody').bodyStart).toBe(8);
    const s = locateFrontMatter('---\nid: x\n---');
    expect(s.bodyStart).toBe('---\nid: x\n---'.length);
  });

  it('rejects files without front matter', () => {
    expect(() => locateFrontMatter('Body only')).toThrow(/missing YAML front matter/);
    expect(() => locateFrontMatter('---\nid: x\n')).toThrow(/unterminated/);
  });
});

describe('parseFrontMatter', () => {
  it('returns the data and the text range of every top-level pair', () => {
    const { data, pairs } = parseFrontMatter(doc);
    expect(data['title']).toBe('Quoted   title');
    expect(data['tags']).toEqual(['one', 'two']);
    const title = pairs.get('title')!;
    expect(doc.slice(title.start, title.end)).toBe("title:   'Quoted   title'");
    const tags = pairs.get('tags')!;
    expect(doc.slice(tags.start, tags.end)).toMatch(/^tags:\n {2}\[[\s\S]*\]$/);
  });

  it('handles a key without a value', () => {
    const text = '---\nid: x\nempty:\n---\n';
    const { pairs, data } = parseFrontMatter(text);
    expect(data['empty']).toBeNull();
    const at = pairs.get('empty')!;
    expect(text.slice(at.start, at.end)).toBe('empty:');
  });

  it('rejects invalid YAML and non-mapping front matter', () => {
    expect(() => parseFrontMatter('---\na: [1\n---\n')).toThrow(/invalid YAML/);
    expect(() => parseFrontMatter('---\n- a\n- b\n---\n')).toThrow(/not a mapping/);
    expect(() => parseFrontMatter('---\na: 1\na: 2\n---\n')).toThrow(/invalid YAML/);
  });
});

describe('serialiseField', () => {
  it('writes scalars plainly and quotes where YAML needs it', () => {
    expect(serialiseField('title', 'Plain title')).toBe('title: Plain title');
    expect(serialiseField('title', 'Has: colon')).toBe('title: "Has: colon"');
    expect(serialiseField('training', true)).toBe('training: true');
    expect(serialiseField('version', 3)).toBe('version: 3');
    expect(serialiseField('sourceDate', '2026-09-14')).toBe('sourceDate: 2026-09-14');
    expect(serialiseField('sourceChecksum', '1e10')).toBe('sourceChecksum: "1e10"');
  });

  it('writes lists as flow sequences on one line, without folding', () => {
    expect(serialiseField('tags', ['a', 'b c'])).toBe('tags: [a, b c]');
    const long = 'word '.repeat(60).trim();
    expect(serialiseField('edges', [`${long}|supports|human`])).not.toContain('\n');
    expect(serialiseField('worlds', [])).toBe('worlds: []');
  });
});

describe('editFrontMatter', () => {
  it('changes only the named field and keeps comments and every other byte', () => {
    const out = editFrontMatter(doc, new Map([['title', 'title: New']]));
    expect(out).toBe(doc.replace("title:   'Quoted   title'", 'title: New'));
  });

  it('replaces a multi-line value as a whole', () => {
    const out = editFrontMatter(doc, new Map([['tags', 'tags: [three]']]));
    expect(out).toBe(doc.replace(/tags:\n {2}\[[\s\S]*?\n {2}\]/, 'tags: [three]'));
  });

  it('removes fields: first, middle and last', () => {
    const lines = ['---', 'a: 1', 'b: 2', 'c: 3', '---', 'Body'].join('\n');
    expect(editFrontMatter(lines, new Map([['a', null]]))).toBe('---\nb: 2\nc: 3\n---\nBody');
    expect(editFrontMatter(lines, new Map([['b', null]]))).toBe('---\na: 1\nc: 3\n---\nBody');
    expect(editFrontMatter(lines, new Map([['c', null]]))).toBe('---\na: 1\nb: 2\n---\nBody');
    expect(editFrontMatter('---\na: 1\n---\n', new Map([['a', null]]))).toBe('---\n---\n');
  });

  it('appends new fields at the end of the block, also to an empty block', () => {
    const out = editFrontMatter(doc, new Map([['status', 'status: draft']]));
    expect(out).toBe(doc.replace('x-foreign: {a: 1}\n', 'x-foreign: {a: 1}\nstatus: draft\n'));
    expect(editFrontMatter('---\n---\nB', new Map([['a', 'a: 1']]))).toBe('---\na: 1\n---\nB');
  });

  it('ignores the removal of a field that is not there and no edits at all', () => {
    expect(editFrontMatter(doc, new Map([['nope', null]]))).toBe(doc);
    expect(editFrontMatter(doc, new Map())).toBe(doc);
  });

  it('keeps CRLF line breaks in everything it writes', () => {
    const text = '---\r\nid: x\r\ntitle: Old\r\n---\r\n\r\nBody\r\n';
    const out = editFrontMatter(
      text,
      new Map([
        ['title', 'title: New'],
        ['status', 'status: draft'],
      ]),
    );
    expect(out).toBe('---\r\nid: x\r\ntitle: New\r\nstatus: draft\r\n---\r\n\r\nBody\r\n');
  });

  it('combines a removal of the last field with an addition', () => {
    const text = '---\na: 1\nb: 2\n---\n';
    const out = editFrontMatter(
      text,
      new Map([
        ['b', null],
        ['c', 'c: 3'],
      ]),
    );
    expect(out).toBe('---\na: 1\nc: 3\n---\n');
  });
});

describe('withEol', () => {
  it('converts only when the file is not LF', () => {
    expect(withEol('a\nb', '\n')).toBe('a\nb');
    expect(withEol('a\nb', '\r\n')).toBe('a\r\nb');
  });
});

describe('editFrontMatter with multi-line values', () => {
  const wrap = (field: string, rest = 'next: 1\n') => `---\nid: x\n${field}${rest}---\nBody\n`;
  const edit = (text: string, key: string, line: string | null) =>
    editFrontMatter(text, new Map([[key, line]]));

  for (const header of ['|', '|-', '|+', '>', '>-']) {
    it(`replaces a ${header} block scalar in the middle and keeps what follows`, () => {
      const text = wrap(`title: ${header}\n  line one\n  line two\n# comment line\n`);
      expect(edit(text, 'title', 'title: New')).toBe(wrap('title: New\n# comment line\n'));
    });

    it(`replaces a ${header} block scalar in the last position`, () => {
      const text = wrap(`title: ${header}\n  line one\n  line two\n`, '');
      expect(edit(text, 'title', 'title: New')).toBe(wrap('title: New\n', ''));
    });

    it(`removes a ${header} block scalar without eating the next field`, () => {
      const text = wrap(`title: ${header}\n  line one\n  line two\n`);
      expect(edit(text, 'title', null)).toBe(wrap(''));
    });
  }

  it('replaces a block sequence in the middle, last, and before a comment', () => {
    const seq = 'tags:\n  - a\n  - b # trailing\n';
    expect(edit(wrap(seq), 'tags', 'tags: [c]')).toBe(
      wrap('tags: [c] # trailing\n'.replace(' # trailing', '')),
    );
    expect(edit(wrap(seq, ''), 'tags', 'tags: [c]')).toBe(wrap('tags: [c]\n', ''));
    expect(edit(wrap(`${seq}# keep\n`), 'tags', 'tags: [c]')).toBe(wrap('tags: [c]\n# keep\n'));
    expect(edit(wrap(seq), 'tags', null)).toBe(wrap(''));
  });

  it('keeps a trailing comment of a plain value', () => {
    expect(edit(wrap('title: Old # note\n'), 'title', 'title: New')).toBe(
      wrap('title: New # note\n'),
    );
  });

  it('works with CRLF line breaks', () => {
    const text = wrap('title: |-\n  one\n  two\n# c\n').replace(/\n/g, '\r\n');
    expect(edit(text, 'title', 'title: New')).toBe(
      wrap('title: New\n# c\n').replace(/\n/g, '\r\n'),
    );
  });

  it('survives repeated patches of a multi-line title', () => {
    let text = wrap('title: first\n');
    for (const title of ['two\nlines', 'three\nlines\nnow', 'single', 'back\nagain']) {
      text = edit(text, 'title', serialiseField('title', title));
      expect(parseFrontMatter(text).data).toEqual({ id: 'x', title, next: 1 });
      expect(text.endsWith('next: 1\n---\nBody\n')).toBe(true);
    }
  });
});
