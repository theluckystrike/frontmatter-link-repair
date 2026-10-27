import { browser, expect } from '@wdio/globals';

// A free user can select Export report in the repair window. The click shows the shared Pro notice with the
// "Sponsor on GitHub" button and writes no report. A Pro user (simulated GitHub Sponsors answer) gets the report.
const ID = 'frontmatter-link-repair';
const LEAD = 'Report export is a Pro feature.';
const NOTE = '---\nparent: [[Some note]]\n---\nBody\n';

interface P {
	settings: { folder: string; keys: string };
	pro: { opts: { http: unknown }; signOut(): void; refreshNow(): Promise<unknown>; isPro(): boolean };
	saveSettings(): Promise<void>;
}

async function prepare(pro: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, note, pro) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		if (!app.vault.getAbstractFileByPath('E2E/ProNotice')) await app.vault.createFolder('E2E/ProNotice');
		const f = app.vault.getFileByPath('E2E/ProNotice/Note.md');
		if (f) await app.vault.modify(f, note); else await app.vault.create('E2E/ProNotice/Note.md', note);
		for (const r of app.vault.getFiles().filter((x) => x.path.startsWith('Frontmatter Link Repair/Reports/'))) await app.fileManager.trashFile(r);
		p.pro.signOut();
		if (pro) {
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		}
		p.settings.folder = 'E2E/ProNotice'; p.settings.keys = 'parent';
		await p.saveSettings();
		activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
	}, ID, NOTE, pro);
	await browser.executeObsidianCommand(`${ID}:preview-repair`);
	const modal = browser.$('.flr-repair');
	await modal.waitForDisplayed({ timeout: 30000 });
	await modal.$('button=Preview').click();
	await browser.waitUntil(async () => (await modal.$('.flr-summary').getText()).startsWith('1 matches'), { timeout: 30000, timeoutMsg: 'The preview shows no match.' });
}

async function state(): Promise<{ notices: { text: string; buttons: number }[]; reports: number; note: string; disabled: boolean }> {
	return browser.executeObsidian(async ({ app }) => {
		const doc = activeWindow.document;
		const button = [...doc.querySelectorAll<HTMLButtonElement>('.flr-repair button')].find((b) => b.textContent === 'Export report (Pro)');
		return {
			notices: [...doc.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			reports: app.vault.getFiles().filter((f) => f.path.startsWith('Frontmatter Link Repair/Reports/')).length,
			note: await app.vault.read(app.vault.getFileByPath('E2E/ProNotice/Note.md')!),
			disabled: button?.disabled ?? true,
		};
	});
}

describe(`${ID} Export report for a free user and a Pro user`, function () {
	afterEach(async () => {
		await browser.keys('Escape');
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!.pro.signOut();
			activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, ID);
	});

	it('a free user who selects Export report gets a Pro notice with a Sponsor button, and no report is written', async () => {
		await prepare(false);
		expect((await state()).disabled).toBe(false);
		await browser.$('.flr-repair').$('button=Export report (Pro)').click();
		await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes(LEAD)), { timeout: 5000, timeoutMsg: `No Pro notice after Export report: ${JSON.stringify(await state())}` });
		const s = await state();
		expect(s.notices.find((n) => n.text.includes(LEAD))?.buttons).toBe(1);
		expect(s.reports).toBe(0);
		expect(s.note).toBe(NOTE);
	});

	it('a Pro user who selects Export report gets the report note, with no Pro notice', async () => {
		await prepare(true);
		await browser.$('.flr-repair').$('button=Export report (Pro)').click();
		await browser.waitUntil(async () => (await state()).reports === 1, { timeout: 10000, timeoutMsg: `No report note: ${JSON.stringify(await state())}` });
		expect((await state()).notices.filter((n) => n.buttons > 0)).toHaveLength(0);
	});
});
