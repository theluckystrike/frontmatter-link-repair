import { describe, expect, it } from 'vitest';
import vectors from './vectors/frontmatter-link-repair.json';
import { repairText } from '../src/repair';

describe('golden vectors (packages/spec/vectors/frontmatter-link-repair.json)', () => {
	it('has 20 or more cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [text, keys] = c.args as [string, string[]];
			expect(repairText(text, keys)).toEqual(c.expected);
		});
	}
});
