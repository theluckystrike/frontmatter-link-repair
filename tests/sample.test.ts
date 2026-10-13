import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import FrontmatterLinkRepairPlugin from '../src/main';
import { matchId } from '../src/repair';
import manifest from '../manifest.json';

// The qa.json shots expect these numbers from docs/sample-notes.
function sampleFiles(): Record<string, string> {
	const root = join(__dirname, '..', 'docs', 'sample-notes');
	const out: Record<string, string> = {};
	const walk = (dir: string, rel: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`);
			else out[`Frontmatter Link Repair/${rel}${e.name}`] = readFileSync(join(dir, e.name), 'utf8');
		}
	};
	walk(root, '');
	return out;
}

describe('sample notes', () => {
	it('give 4 matches in 3 notes and 3 skipped parts', async () => {
		const files = sampleFiles();
		const app = App.createConfigured__({ files });
		const plugin = new FrontmatterLinkRepairPlugin(app as never, manifest as never);
		const plan = await plugin.prepare('Frontmatter Link Repair/Projects', 'parent, parents, up, related');
		expect(plan.files.map((f) => [f.path.split('/').pop(), f.matches.length, f.skips.map((s) => s.reason)])).toEqual([
			['Atlas.md', 2, []],
			['Beacon.md', 1, []],
			['Cobalt.md', 0, ['Quote or backslash in the link text', 'Flow list, comment or text next to the link']],
			['Delta.md', 1, ['Nested mapping or nested list']],
		]);
		const checked = new Set(plan.files.flatMap((f) => f.matches.map((m) => matchId(f.path, m))));
		const r = await plugin.applyPlan(plan, checked);
		expect(r.written).toBe(3);
		const atlas = await app.vault.read(app.vault.getFileByPath('Frontmatter Link Repair/Projects/Atlas.md')!);
		expect(atlas).toContain('parent: "[[Roadmap]]"\nrelated:\n  - "[[Beacon|Beacon project]]"\n  - "[[Cobalt]]"\n---\n# Atlas\n\nThe Atlas team works on search. See [[Beacon]] for the API.\n');
	});
});
