// Raw frontmatter scanner. It reads the text of one note line by line and never parses YAML into values,
// so the note body and the line endings stay byte for byte. It only changes a selected top-level key whose
// value, or whose simple block list item, is one complete unquoted wiki link. Anything else is left as is.

/** One proposed change: the exact old line and the new line, 1-based line number in the note. */
export interface RepairMatch {
	line: number;
	key: string;
	old: string;
	new: string;
}

/** A part of the note that the scanner did not change, and the reason. line 0 = the whole file. */
export interface RepairSkip {
	line: number;
	key: string;
	reason: string;
}

export interface RepairResult {
	/** The note text with every match applied. Equal to the input when there are no matches. */
	output: string;
	matches: RepairMatch[];
	skips: RepairSkip[];
}

export const REASON = {
	noClose: 'No closing frontmatter delimiter',
	lineEnding: 'Carriage return without a line feed in frontmatter',
	tab: 'Tab in the indentation',
	duplicate: 'Duplicate key',
	nested: 'Nested mapping or nested list',
	multiline: 'Multiline scalar',
	flow: 'Flow list, comment or text next to the link',
	quoteInLink: 'Quote or backslash in the link text',
	commaInLink: 'Comma in the link text, YAML reads a list with more than one item',
	indicatorInLink: 'YAML indicator in the link text',
	anchor: 'Anchor, alias or tag',
	unsupportedLine: 'Unsupported YAML line with a wiki link',
} as const;

interface Line {
	text: string;
	eol: string;
}

/** Splits text into lines and keeps the exact line ending of each line ('' for the last line without one). */
export function splitLines(text: string): Line[] {
	const out: Line[] = [];
	let start = 0;
	while (start <= text.length) {
		const nl = text.indexOf('\n', start);
		if (nl < 0) {
			out.push({ text: text.slice(start), eol: '' });
			break;
		}
		const cr = nl > start && text[nl - 1] === '\r';
		out.push({ text: text.slice(start, cr ? nl - 1 : nl), eol: cr ? '\r\n' : '\n' });
		start = nl + 1;
	}
	return out;
}

/** Splits a comma separated key list, trims each key and drops empty and repeated keys. */
export function parseKeys(text: string): string[] {
	const seen = new Set<string>();
	for (const raw of text.split(',')) {
		const k = raw.trim();
		if (k) seen.add(k);
	}
	return [...seen];
}

// Obsidian (getFrontMatterInfo) needs "---" with nothing after it on the opening and the closing line.
const DELIM = /^---$/;
// A plain top-level key: no indent, no list dash, no quote, no flow or complex key indicator.
const KEY_LINE = /^([^\s#'"\-?[\]{},&*!|>%@`:][^:]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const ITEM_LINE = /^([ ]*)-(?:[ \t]+(.*?))?[ \t]*$/;
const LINK = /^\[\[([^[\]\r\n]+)\]\]$/;

type Value = { kind: 'link'; token: string } | { kind: 'none' } | { kind: 'skip'; reason: string } | { kind: 'block' };

/** Classifies a value on one line (after "key:" or "- "). */
export function classifyValue(value: string): Value {
	if (value === '' || value.startsWith('#')) return { kind: 'block' };
	if (value.startsWith('"') || value.startsWith("'")) return { kind: 'none' };
	if (/^[|>]/.test(value)) return { kind: 'skip', reason: REASON.multiline };
	if (/^[&*!]/.test(value)) return { kind: 'skip', reason: REASON.anchor };
	if (!value.startsWith('[')) return { kind: 'none' };
	const m = LINK.exec(value);
	if (!m) return { kind: 'skip', reason: REASON.flow };
	const inner = m[1]!;
	if (/["\\]/.test(inner) || /^\s*'/.test(inner)) return { kind: 'skip', reason: REASON.quoteInLink };
	if (inner.includes(',')) return { kind: 'skip', reason: REASON.commaInLink };
	if (/[{}]/.test(inner) || /\s#/.test(inner) || /:(\s|$)/.test(inner) || /^\s*[&*!?-]/.test(inner)) return { kind: 'skip', reason: REASON.indicatorInLink };
	return { kind: 'link', token: value };
}

function quoteLine(text: string, token: string, from: number): string {
	const at = text.indexOf(token, from);
	return `${text.slice(0, at)}"${token}"${text.slice(at + token.length)}`;
}

/**
 * Scans the raw frontmatter of one note for the selected top-level keys. Pure: no vault access.
 * A key that is not in keys is never changed. The body after the closing delimiter is never read for links.
 */
export function repairText(text: string, keys: string[]): RepairResult {
	const result: RepairResult = { output: text, matches: [], skips: [] };
	const lines = splitLines(text);
	if (lines.length < 2 || !DELIM.test(lines[0]!.text) || lines[0]!.eol === '') return result;
	let close = -1;
	for (let i = 1; i < lines.length; i++) {
		if (DELIM.test(lines[i]!.text) && lines[i - 1]!.eol !== '') {
			close = i;
			break;
		}
	}
	if (close < 0) {
		result.skips.push({ line: 0, key: '', reason: REASON.noClose });
		return result;
	}
	for (let i = 1; i < close; i++) {
		if (lines[i]!.text.includes('\r')) {
			result.skips.push({ line: i + 1, key: '', reason: REASON.lineEnding });
			return result;
		}
	}
	const selected = new Set(keys);
	const seen = new Map<string, number>();
	const perKey = new Map<string, { matches: RepairMatch[]; skips: RepairSkip[] }>();

	let i = 1;
	while (i < close) {
		const t = lines[i]!.text;
		if (t.trim() === '' || /^\s*#/.test(t)) {
			i++;
			continue;
		}
		const km = /^\S/.test(t) ? KEY_LINE.exec(t) : null;
		if (!km) {
			// Not a plain top-level key line. Report it only when it holds a link, then skip its block.
			if (t.includes('[[') && /^\S/.test(t)) result.skips.push({ line: i + 1, key: '', reason: REASON.unsupportedLine });
			i++;
			while (i < close && (/^\s/.test(lines[i]!.text) || lines[i]!.text === '')) i++;
			continue;
		}
		const key = km[1]!;
		const value = km[2] ?? '';
		const start = i;
		i++;
		// The block of this key: indented lines, blank lines, comments, and column 0 list items when the value is empty.
		const v = classifyValue(value);
		while (i < close) {
			const n = lines[i]!.text;
			if (n === '' || /^\s/.test(n) || /^#/.test(n) || (v.kind === 'block' && /^-(\s|$)/.test(n))) i++;
			else break;
		}
		if (!selected.has(key)) continue;
		const count = (seen.get(key) ?? 0) + 1;
		seen.set(key, count);
		const bucket = { matches: [] as RepairMatch[], skips: [] as RepairSkip[] };
		if (count > 1) {
			perKey.set(key, { matches: [], skips: [{ line: start + 1, key, reason: REASON.duplicate }] });
			continue;
		}
		perKey.set(key, bucket);
		const block = lines.slice(start + 1, i).map((l, k) => ({ text: l.text, line: start + 2 + k }));
		const content = block.filter((b) => b.text.trim() !== '' && !/^\s*#/.test(b.text));
		if (v.kind !== 'block') {
			if (content.length > 0) {
				bucket.skips.push({ line: start + 1, key, reason: REASON.multiline });
				continue;
			}
			if (v.kind === 'skip') bucket.skips.push({ line: start + 1, key, reason: v.reason });
			else if (v.kind === 'link') bucket.matches.push({ line: start + 1, key, old: t, new: quoteLine(t, v.token, t.indexOf(':') + 1) });
			continue;
		}
		if (content.length === 0) continue;
		if (content.some((b) => /^ *\t/.test(b.text))) {
			bucket.skips.push({ line: start + 1, key, reason: REASON.tab });
			continue;
		}
		const first = ITEM_LINE.exec(content[0]!.text);
		if (!first) {
			bucket.skips.push({ line: start + 1, key, reason: REASON.nested });
			continue;
		}
		const indent = first[1]!;
		let bad = false;
		const items: { line: number; text: string; value: string }[] = [];
		for (const b of content) {
			const im = ITEM_LINE.exec(b.text);
			if (!im || im[1] !== indent) {
				bad = true;
				break;
			}
			items.push({ line: b.line, text: b.text, value: im[2] ?? '' });
		}
		if (bad) {
			bucket.skips.push({ line: start + 1, key, reason: REASON.nested });
			continue;
		}
		for (const it of items) {
			const iv = classifyValue(it.value);
			if (iv.kind === 'block' || /^[^\s'"[{#][^:]*:(\s|$)/.test(it.value)) bucket.skips.push({ line: it.line, key, reason: REASON.nested });
			else if (iv.kind === 'skip') bucket.skips.push({ line: it.line, key, reason: iv.reason });
			else if (iv.kind === 'link') bucket.matches.push({ line: it.line, key, old: it.text, new: quoteLine(it.text, iv.token, it.text.indexOf('-') + 1) });
		}
	}
	for (const b of perKey.values()) {
		result.matches.push(...b.matches);
		result.skips.push(...b.skips);
	}
	result.matches.sort((a, b) => a.line - b.line);
	result.skips.sort((a, b) => a.line - b.line);
	result.output = applyMatches(text, result.matches);
	return result;
}

/**
 * Replaces the line of each match with its new line. Each old line must still be at its line number,
 * else it throws and the caller writes nothing. Line endings and all other lines stay the same.
 */
export function applyMatches(text: string, matches: readonly RepairMatch[]): string {
	if (matches.length === 0) return text;
	const lines = splitLines(text);
	for (const m of matches) {
		const l = lines[m.line - 1];
		if (!l || l.text !== m.old) throw new Error(`Line ${m.line} changed after preview`);
		l.text = m.new;
	}
	return lines.map((l) => l.text + l.eol).join('');
}

/** Id of one match in the preview: note path and line number. */
export function matchId(path: string, m: RepairMatch): string {
	return `${path}#${m.line}`;
}

/** True when path is the folder itself or inside it. '' = the vault root. */
export function inFolder(path: string, folder: string): boolean {
	const f = folder.replace(/^\/+|\/+$/g, '');
	return f === '' || path.startsWith(`${f}/`);
}

export interface FileReport {
	path: string;
	matches: RepairMatch[];
	skips: RepairSkip[];
}

export interface ApplyOutcome {
	path: string;
	status: 'written' | 'stale' | 'failed';
	restore?: string;
	message?: string;
}

/** Markdown text of a repair report: matches, skipped parts with reasons, and the result of each write. */
export function reportText(folder: string, keys: string[], files: readonly FileReport[], outcomes: readonly ApplyOutcome[], stamp: string): string {
	const out: string[] = ['# Frontmatter link repair report', '', `- Date: ${stamp}`, `- Folder: ${folder || '(vault root)'}`, `- Keys: ${keys.join(', ')}`];
	const matchCount = files.reduce((n, f) => n + f.matches.length, 0);
	const skipCount = files.reduce((n, f) => n + f.skips.length, 0);
	out.push(`- Matches: ${matchCount}`, `- Skipped parts: ${skipCount}`, '');
	out.push('## Matches', '');
	if (matchCount === 0) out.push('None.', '');
	for (const f of files) {
		for (const m of f.matches) {
			out.push(`- ${f.path}, line ${m.line}, key ${m.key}`, '  ```', `  ${m.old}`, `  ${m.new}`, '  ```');
		}
	}
	if (matchCount) out.push('');
	out.push('## Skipped', '');
	if (skipCount === 0) out.push('None.', '');
	for (const f of files) for (const s of f.skips) out.push(`- ${f.path}${s.line ? `, line ${s.line}` : ''}${s.key ? `, key ${s.key}` : ''}: ${s.reason}`);
	if (skipCount) out.push('');
	if (outcomes.length) {
		out.push('## Writes', '');
		for (const o of outcomes) out.push(`- ${o.path}: ${o.status}${o.restore ? `, restore copy ${o.restore}` : ''}${o.message ? `, ${o.message}` : ''}`);
		out.push('');
	}
	return out.join('\n');
}
