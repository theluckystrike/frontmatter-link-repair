import { browser, expect } from '@wdio/globals';

interface Outcome { path: string; status: string; restore?: string; message?: string }
interface TestPlugin {
	settings: { folder: string; keys: string; restoreFolder: string; presets: { name: string; folder: string; keys: string }[] };
	pro: { opts: { http: (request: unknown) => Promise<unknown> }; signOut(): void; refreshNow(): Promise<unknown>; isPro(): boolean };
	lastResult: { outcomes: Outcome[]; written: number; stale: number; failed: number } | null;
	saveSettings(): Promise<void>;
	savePreset(name: string, folder: string, keys: string): Promise<boolean>;
	exportReport(plan: unknown, result: unknown): Promise<{ path: string } | null>;
	prepare(folder: string, keys: string): Promise<{ files: { path: string; matches: { line: number }[] }[] }>;
	applyPlan(plan: unknown, checked: Set<string>): Promise<{ outcomes: Outcome[]; written: number; stale: number; failed: number }>;
}
type WithPlugins = { plugins: { plugins: Record<string, TestPlugin> } };

const NOTE = '---\nparent: [[Some note]]\nparents:\n  - [[A|Alias]]\n---\nBody [[A]]\n';
const FIXED = '---\nparent: "[[Some note]]"\nparents:\n  - "[[A|Alias]]"\n---\nBody [[A]]\n';

async function writeNote(path: string, text: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, path, text) => {
		const parts = path.split('/');
		parts.pop();
		let folder = '';
		for (const part of parts) {
			folder = folder ? `${folder}/${part}` : part;
			if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
		}
		const file = app.vault.getFileByPath(path);
		if (file) await app.vault.modify(file, text);
		else await app.vault.create(path, text);
	}, path, text);
}

async function reset(folder: string, pro = false): Promise<void> {
	await browser.executeObsidian(async ({ app }, folder, pro) => {
		const p = (app as unknown as WithPlugins).plugins.plugins['frontmatter-link-repair']!;
		p.pro.signOut();
		p.lastResult = null;
		p.settings.folder = folder;
		p.settings.keys = 'parent, parents';
		p.settings.presets = [];
		if (pro) {
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'test-sponsor' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('frontmatter-link-repair-github-token', 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
			if (!p.pro.isPro()) throw new Error('Local sponsor fixture did not turn on Pro');
		}
		await p.saveSettings();
	}, folder, pro);
}

async function read(path: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, path) => {
		const f = app.vault.getFileByPath(path);
		if (!f) throw new Error(`Missing ${path}`);
		return app.vault.read(f);
	}, path);
}

describe('Frontmatter Link Repair in a real vault', function () {
	it('previews through the command, applies through the button and keeps a restore copy', async function () {
		await writeNote('E2E/Core/Note.md', NOTE);
		await reset('E2E/Core');
		await browser.executeObsidianCommand('frontmatter-link-repair:preview-repair');
		const modal = browser.$('.flr-repair');
		await modal.waitForDisplayed({ timeout: 30000 });
		await modal.$('button=Preview').click();
		await browser.waitUntil(async () => (await modal.$('.flr-summary').getText()).startsWith('2 matches in 1 notes'), { timeout: 30000 });
		expect(await modal.$('.flr-old').getText()).toBe('parent: [[Some note]]');
		expect(await modal.$('.flr-new').getText()).toBe('parent: "[[Some note]]"');
		expect(await read('E2E/Core/Note.md')).toBe(NOTE);
		await modal.$('button=Apply checked').click();
		await browser.waitUntil(async () => (await modal.$('.flr-result').getText()).includes('1 notes written'), { timeout: 30000 });
		expect(await read('E2E/Core/Note.md')).toBe(FIXED);
		const restore = await browser.executeObsidian(({ app }) => (app as unknown as WithPlugins).plugins.plugins['frontmatter-link-repair']!.lastResult!.outcomes[0]!.restore!);
		expect(restore.startsWith('Frontmatter Link Repair/Restore copies/')).toBe(true);
		expect(await read(restore)).toBe(NOTE);
		await browser.keys('Escape');
	});

	it('writes only the checked matches', async function () {
		await writeNote('E2E/Checked/Note.md', NOTE);
		await reset('E2E/Checked');
		await browser.executeObsidianCommand('frontmatter-link-repair:preview-repair');
		const modal = browser.$('.flr-repair');
		await modal.waitForDisplayed({ timeout: 30000 });
		await modal.$('button=Preview').click();
		await modal.$('input[data-match="E2E/Checked/Note.md#2"]').waitForExist({ timeout: 30000 });
		await modal.$('input[data-match="E2E/Checked/Note.md#2"]').click();
		await modal.$('button=Apply checked').click();
		await browser.waitUntil(async () => (await modal.$('.flr-result').getText()).includes('1 notes written'), { timeout: 30000 });
		expect(await read('E2E/Checked/Note.md')).toBe('---\nparent: [[Some note]]\nparents:\n  - "[[A|Alias]]"\n---\nBody [[A]]\n');
		await browser.keys('Escape');
	});

	it('shows a stale preview warning and writes nothing when the note changed', async function () {
		await writeNote('E2E/Stale/Note.md', NOTE);
		await reset('E2E/Stale');
		await browser.executeObsidianCommand('frontmatter-link-repair:preview-repair');
		const modal = browser.$('.flr-repair');
		await modal.waitForDisplayed({ timeout: 30000 });
		await modal.$('button=Preview').click();
		await modal.$('.flr-summary').waitForExist({ timeout: 30000 });
		await writeNote('E2E/Stale/Note.md', `${NOTE}Changed\n`);
		await modal.$('button=Apply checked').click();
		await modal.$('.flr-stale').waitForExist({ timeout: 30000 });
		expect(await read('E2E/Stale/Note.md')).toBe(`${NOTE}Changed\n`);
		await browser.keys('Escape');
	});

	it('skips ambiguous YAML and leaves the note the same', async function () {
		const text = '---\nparent: [["A"]]\nparents:\n  name: [[B]]\n---\n';
		await writeNote('E2E/Skip/Note.md', text);
		await reset('E2E/Skip');
		const plan = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as WithPlugins).plugins.plugins['frontmatter-link-repair']!;
			return p.prepare('E2E/Skip', 'parent, parents');
		});
		expect(plan.files[0]!.matches).toEqual([]);
		expect(await read('E2E/Skip/Note.md')).toBe(text);
	});

	it('blocks presets and report export without Pro and allows them with a local sponsor fixture', async function () {
		await writeNote('E2E/Pro/Note.md', NOTE);
		await reset('E2E/Pro');
		const free = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as WithPlugins).plugins.plugins['frontmatter-link-repair']!;
			const plan = await p.prepare('E2E/Pro', 'parent');
			return { preset: await p.savePreset('X', 'E2E/Pro', 'parent'), report: await p.exportReport(plan, null) };
		});
		expect(free).toEqual({ preset: false, report: null });
		await reset('E2E/Pro', true);
		const pro = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as WithPlugins).plugins.plugins['frontmatter-link-repair']!;
			const plan = await p.prepare('E2E/Pro', 'parent');
			const saved = await p.savePreset('Pro notes', 'E2E/Pro', 'parent');
			const file = await p.exportReport(plan, null);
			const f = file ? app.vault.getFileByPath(file.path) : null;
			const text = f ? await app.vault.read(f) : '';
			p.pro.signOut();
			return { saved, presets: p.settings.presets, text };
		});
		expect(pro.saved).toBe(true);
		expect(pro.presets).toEqual([{ name: 'Pro notes', folder: 'E2E/Pro', keys: 'parent' }]);
		expect(pro.text).toContain('E2E/Pro/Note.md, line 2, key parent');
	});
});
