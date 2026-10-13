import { describe, expect, it } from 'vitest';
import { REASON, applyMatches, classifyValue, inFolder, parseKeys, repairText, reportText, splitLines } from '../src/repair';

const K = ['parent', 'parents'];

describe('repairText', () => {
	it('keeps the note body bytes when the frontmatter changes', () => {
		const body = '\nSee [[A]].\nparent: [[B]]\n---\nparents:\n  - [[C]]\n';
		const r = repairText(`---\nparent: [[A]]\n---${body}`, K);
		expect(r.output).toBe(`---\nparent: "[[A]]"\n---${body}`);
		expect(r.matches).toHaveLength(1);
	});
	it('keeps the token text for a block reference', () => {
		const r = repairText('---\nparent: [[Folder/A note#^abc123|Shown text]]\n---\n', K);
		expect(r.matches[0]!.new).toBe('parent: "[[Folder/A note#^abc123|Shown text]]"');
	});
	it('changes only the selected key when two keys hold links', () => {
		const r = repairText('---\nparent: [[A]]\nother: [[B]]\n---\n', ['other']);
		expect(r.output).toBe('---\nparent: [[A]]\nother: "[[B]]"\n---\n');
	});
	it('skips a file with a lone carriage return in frontmatter', () => {
		const r = repairText('---\nparent: [[A]]\rx\n---\n', K);
		expect(r.skips).toEqual([{ line: 2, key: '', reason: REASON.lineEnding }]);
		expect(r.output).toBe('---\nparent: [[A]]\rx\n---\n');
	});
	it('reports a quoted key line with a link', () => {
		const r = repairText('---\n"parent": [[A]]\n---\n', K);
		expect(r.skips).toEqual([{ line: 2, key: '', reason: REASON.unsupportedLine }]);
		expect(r.matches).toEqual([]);
	});
	it('does not read a delimiter in the middle of a line', () => {
		expect(repairText('----\nparent: [[A]]\n---\n', K).matches).toHaveLength(0);
	});
	it('uses the delimiter rule of Obsidian, so it does not change body text', () => {
		// Obsidian reads frontmatter only from "---" + line ending to a "---" line with nothing after it.
		const open = '--- \nparent: [[A]]\n---\n';
		expect(repairText(open, K)).toEqual({ output: open, matches: [], skips: [] });
		const close = '---\nparent: [[A]]\n--- \nBody\n';
		expect(repairText(close, K).output).toBe(close);
		expect(repairText(close, K).skips).toEqual([{ line: 0, key: '', reason: REASON.noClose }]);
	});
	it('skips a block item that holds a nested mapping', () => {
		const r = repairText('---\nparents:\n  - name: [[A]]\n---\n', K);
		expect(r.matches).toEqual([]);
		expect(r.skips).toEqual([{ line: 3, key: 'parents', reason: REASON.nested }]);
	});
	it('returns the input object text unchanged when there is nothing to do', () => {
		const t = '# No frontmatter\n[[A]]\n';
		expect(repairText(t, K)).toEqual({ output: t, matches: [], skips: [] });
	});
});

describe('helpers', () => {
	it('classifies values', () => {
		expect(classifyValue('[[A]]')).toEqual({ kind: 'link', token: '[[A]]' });
		expect(classifyValue('')).toEqual({ kind: 'block' });
		expect(classifyValue('# note')).toEqual({ kind: 'block' });
		expect(classifyValue('>-')).toEqual({ kind: 'skip', reason: REASON.multiline });
		expect(classifyValue('[[A: b]]')).toEqual({ kind: 'skip', reason: REASON.indicatorInLink });
		expect(classifyValue('[[A{b}]]')).toEqual({ kind: 'skip', reason: REASON.indicatorInLink });
		expect(classifyValue("[['A']]")).toEqual({ kind: 'skip', reason: REASON.quoteInLink });
		expect(classifyValue('text')).toEqual({ kind: 'none' });
	});
	it('splits lines and keeps the line endings', () => {
		expect(splitLines('a\r\nb\nc')).toEqual([
			{ text: 'a', eol: '\r\n' },
			{ text: 'b', eol: '\n' },
			{ text: 'c', eol: '' },
		]);
	});
	it('parses keys', () => {
		expect(parseKeys(' parent, ,parents,parent ')).toEqual(['parent', 'parents']);
		expect(parseKeys('')).toEqual([]);
	});
	it('rejects a match whose line changed', () => {
		expect(() => applyMatches('---\nparent: [[B]]\n---\n', [{ line: 2, key: 'parent', old: 'parent: [[A]]', new: 'parent: "[[A]]"' }])).toThrow('changed after preview');
	});
	it('tests folder membership', () => {
		expect(inFolder('A/b.md', 'A')).toBe(true);
		expect(inFolder('AB/b.md', 'A')).toBe(false);
		expect(inFolder('b.md', '')).toBe(true);
		expect(inFolder('A/b.md', '/A/')).toBe(true);
	});
	it('writes a report with matches, skips and writes', () => {
		const text = reportText('Notes', ['parent'], [{ path: 'Notes/a.md', matches: [{ line: 2, key: 'parent', old: 'parent: [[A]]', new: 'parent: "[[A]]"' }], skips: [{ line: 0, key: '', reason: REASON.noClose }] }], [{ path: 'Notes/a.md', status: 'written', restore: 'R/a.md.bak' }], '2026-10-13 101500');
		expect(text).toContain('- Folder: Notes');
		expect(text).toContain('  parent: "[[A]]"');
		expect(text).toContain(`- Notes/a.md: ${REASON.noClose}`);
		expect(text).toContain('- Notes/a.md: written, restore copy R/a.md.bak');
		expect(reportText('', ['parent'], [], [], 'x')).toContain('(vault root)');
	});
});
