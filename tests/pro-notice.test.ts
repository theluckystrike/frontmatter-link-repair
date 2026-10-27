import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import FrontmatterLinkRepairPlugin, { REPORT_FOLDER } from '../src/main';
import { bindPro, PRO_REPORT, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select Export report in the repair window. The click shows the shared Pro notice with a
// Sponsor button and writes no report. A Pro user's click writes the report note, as before.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const A = '---\nparent: [[Some note]]\n---\nBody\n';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'frontmatter-link-repair' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'Notes/A.md': A } });
	const plugin = new FrontmatterLinkRepairPlugin(app as never, manifest as never);
	plugin.now = () => new Date(2026, 9, 13, 10, 15, 0);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	plugin.settings.folder = 'Notes';
	const modal = plugin.openPreview();
	await modal.runPreview();
	const button = [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Export report (Pro)')!;
	const reports = () => app.vault.getFiles().filter((f) => f.path.startsWith(`${REPORT_FOLDER}/`)).length;
	return { app, modal, button, shown, reports };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Export report in the repair window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Export report gets the Pro notice with a Sponsor button, and no report is written', async () => {
		const { app, modal, button, shown, reports } = await setup(false);
		expect(button.disabled).toBe(false);
		button.click(); await flush();
		expect(shown).toEqual([{ text: `${PRO_REPORT} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(reports()).toBe(0);
		expect(app.vault.getAbstractFileByPath(REPORT_FOLDER)).toBeNull();
		expect(await app.vault.read(app.vault.getFileByPath('Notes/A.md')!)).toBe(A);
		modal.close();
	});

	it('a Pro user who selects Export report writes the report note, with no Pro notice', async () => {
		const { modal, button, shown, reports } = await setup(true);
		button.click(); await flush(); await flush();
		expect(reports()).toBe(1);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
