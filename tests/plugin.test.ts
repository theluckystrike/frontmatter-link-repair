import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import FrontmatterLinkRepairPlugin, { REPORT_FOLDER, fileStamp, matchId } from '../src/main';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, FrontmatterLinkRepairSettingTab, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';
import { SHOW_FILES } from '../src/ui';

const A = '---\nparent: [[Some note]]\nparents:\n  - [[B|Alias]]\n---\nBody [[C]]\n';
const A_FIXED = '---\nparent: "[[Some note]]"\nparents:\n  - "[[B|Alias]]"\n---\nBody [[C]]\n';
const QUOTED = '---\nparent: "[[Some note]]"\n---\n';
const AMBIG = '---\nparent: [["A"]]\n---\n';

function setup(files: Record<string, string> = { 'Notes/A.md': A, 'Notes/Quoted.md': QUOTED, 'Notes/Ambig.md': AMBIG, 'Other/D.md': A }) {
	const app = App.createConfigured__({ files });
	const plugin = new FrontmatterLinkRepairPlugin(app as never, manifest as never);
	plugin.now = () => new Date(2026, 9, 13, 10, 15, 0);
	return { app, plugin };
}
function fakePro(value: boolean) {
	let pro = value;
	const listeners = new Set<() => void>();
	const manager = { isPro: () => pro, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
	bindPro(manager as never);
	return { set: (v: boolean) => { pro = v; for (const fn of listeners) fn(); }, listeners };
}
function all(plan: { files: { path: string; matches: { line: number }[] }[] }): Set<string> {
	const s = new Set<string>();
	for (const f of plan.files) for (const m of f.matches) s.add(matchId(f.path, m as never));
	return s;
}
async function read(app: ReturnType<typeof setup>['app'], path: string): Promise<string> {
	const f = app.vault.getFileByPath(path);
	if (!f) throw new Error(`missing ${path}`);
	return app.vault.read(f);
}

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

describe('settings and Pro', () => {
	it('loads defaults', async () => {
		const { plugin } = setup();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});
	it('repairs bad saved settings', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ folder: 3, keys: [], restoreFolder: '/', presets: 'x' })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ restoreFolder: ' // ' }).restoreFolder).toBe(DEFAULT_SETTINGS.restoreFolder);
		expect(normalizeSettings({ presets: [{ name: 'a', folder: 'F', keys: 'k' }, { name: 'a' }, { name: '' }, 5] }).presets).toEqual([{ name: 'a', folder: 'F', keys: 'k' }]);
	});
	it('accepts only the free fields from the settings tab', async () => {
		const { app, plugin } = setup();
		const tab = new FrontmatterLinkRepairSettingTab(app as never, plugin);
		await tab.setControlValue('presets', [{ name: 'x', folder: '', keys: 'a' }]);
		expect(plugin.settings.presets).toEqual([]);
		await tab.setControlValue('keys', 'up');
		expect(plugin.settings.keys).toBe('up');
	});
	it('labels each Pro heading with (Pro)', () => {
		const { app, plugin } = setup();
		const items = new FrontmatterLinkRepairSettingTab(app as never, plugin).getSettingDefinitions();
		const group = items.find((i) => 'heading' in i && typeof i.heading === 'string' && i.heading.startsWith('Saved presets')) as { heading: string };
		expect(group.heading).toBe('Saved presets (Pro)');
	});
	it('facade follows sign out and removes listeners', () => {
		const m = fakePro(true);
		const fn = vi.fn();
		const off = onProChange(fn);
		m.set(false);
		expect(isPro()).toBe(false);
		expect(fn).toHaveBeenCalledTimes(1);
		off();
		m.set(true);
		expect(fn).toHaveBeenCalledTimes(1);
		resetPro();
		expect(m.listeners.size).toBe(0);
	});
	it('uses the reference sponsor terms', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
	it('makes a file stamp in local time', () => {
		expect(fileStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 030405');
	});
});

describe('preview', () => {
	it('does not write matches outside the visible preview', async () => {
		const files = Object.fromEntries(Array.from({ length: SHOW_FILES + 1 }, (_, n) => [`Notes/${String(n).padStart(3, '0')}.md`, A]));
		const { app, plugin } = setup(files);
		plugin.settings.folder = 'Notes';
		const modal = plugin.openPreview();
		try {
			const plan = await modal.runPreview();
			expect(plan?.files).toHaveLength(SHOW_FILES + 1);
			expect(modal.contentEl.querySelectorAll('input[data-match]')).toHaveLength(SHOW_FILES * 2);
			const result = await modal.runApply();
			expect(result?.written).toBe(SHOW_FILES);
			expect(await read(app, `Notes/${SHOW_FILES}.md`)).toBe(A);
		} finally {
			modal.close();
		}
	});
	it('keeps Apply off after a write when the Pro state redraws the preview', async () => {
		const { plugin } = setup();
		const pro = fakePro(false);
		plugin.settings.folder = 'Notes';
		const modal = plugin.openPreview();
		try {
			await modal.runPreview();
			expect((await modal.runApply())?.written).toBe(1);
			pro.set(true);
			const apply = [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Apply checked');
			expect(apply?.disabled).toBe(true);
		} finally {
			modal.close();
		}
	});
	it('scans one folder and writes nothing', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent, parents');
		expect(plan.scanned).toBe(3);
		expect(plan.files.map((f) => f.path)).toEqual(['Notes/A.md', 'Notes/Ambig.md']);
		expect(plan.files[0]!.matches.map((m) => [m.old, m.new])).toEqual([
			['parent: [[Some note]]', 'parent: "[[Some note]]"'],
			['  - [[B|Alias]]', '  - "[[B|Alias]]"'],
		]);
		expect(plan.files[1]!.skips[0]!.reason).toContain('Quote');
		expect(await read(app, 'Notes/A.md')).toBe(A);
	});
	it('scans the vault root for an empty folder', async () => {
		const { plugin } = setup();
		expect((await plugin.prepare('', 'parent')).scanned).toBe(4);
		expect((await plugin.prepare('/', 'parent')).scanned).toBe(4);
	});
	it('rejects a missing folder and an empty key list', async () => {
		const { plugin } = setup();
		await expect(plugin.prepare('Nope', 'parent')).rejects.toThrow('No folder');
		await expect(plugin.prepare('Notes', ' , ')).rejects.toThrow('keys');
	});
});

describe('apply', () => {
	it('saves a restore copy with the original text before the write', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent, parents');
		const order: string[] = [];
		const create = app.vault.create.bind(app.vault);
		const process = app.vault.process.bind(app.vault);
		vi.spyOn(app.vault, 'create').mockImplementation(async (p, d, o) => { order.push(`create ${p}`); return create(p, d, o); });
		vi.spyOn(app.vault, 'process').mockImplementation(async (f, fn, o) => { order.push(`process ${f.path}`); return process(f, fn, o); });
		const r = await plugin.applyPlan(plan, all(plan));
		const restore = 'Frontmatter Link Repair/Restore copies/2026-10-13 101500/Notes/A.md.bak';
		expect(r).toEqual({ outcomes: [{ path: 'Notes/A.md', status: 'written', restore }], written: 1, stale: 0, failed: 0 });
		expect(order).toEqual([`create ${restore}`, 'process Notes/A.md']);
		expect(await read(app, restore)).toBe(A);
		expect(await read(app, 'Notes/A.md')).toBe(A_FIXED);
		expect(await read(app, 'Other/D.md')).toBe(A);
	});
	it('writes only the checked matches', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent, parents');
		await plugin.applyPlan(plan, new Set([matchId('Notes/A.md', plan.files[0]!.matches[1]!)]));
		expect(await read(app, 'Notes/A.md')).toBe('---\nparent: [[Some note]]\nparents:\n  - "[[B|Alias]]"\n---\nBody [[C]]\n');
	});
	it('writes nothing to a note that changed after the preview', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent');
		await app.vault.modify(app.vault.getFileByPath('Notes/A.md')!, `${A}more\n`);
		const r = await plugin.applyPlan(plan, all(plan));
		expect(r.stale).toBe(1);
		expect(r.outcomes[0]!.message).toContain('changed after the preview');
		expect(await read(app, 'Notes/A.md')).toBe(`${A}more\n`);
		expect(app.vault.getAbstractFileByPath('Frontmatter Link Repair')).toBeNull();
	});
	it('writes nothing when the note changes between the read and the write', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent');
		const process = app.vault.process.bind(app.vault);
		vi.spyOn(app.vault, 'process').mockImplementation(async (f, fn, o) => process(f, (d) => fn(`${d}x`), o));
		const r = await plugin.applyPlan(plan, all(plan));
		expect(r.stale).toBe(1);
		expect(await read(app, 'Notes/A.md')).toBe(A);
	});
	it('reports a deleted note as stale', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent');
		await app.vault.delete(app.vault.getFileByPath('Notes/A.md')!);
		expect((await plugin.applyPlan(plan, all(plan))).outcomes).toEqual([{ path: 'Notes/A.md', status: 'stale', message: 'the note is missing' }]);
	});
	it('does not write the note when the restore copy fails', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent');
		vi.spyOn(app.vault, 'create').mockRejectedValue(new Error('disk full'));
		const r = await plugin.applyPlan(plan, all(plan));
		expect(r.outcomes).toEqual([{ path: 'Notes/A.md', status: 'failed', message: 'disk full' }]);
		expect(await read(app, 'Notes/A.md')).toBe(A);
	});
	it('gives each restore copy a unique name', async () => {
		const { app, plugin } = setup();
		const plan1 = await plugin.prepare('Notes', 'parent');
		await plugin.applyPlan(plan1, all(plan1));
		await app.vault.modify(app.vault.getFileByPath('Notes/A.md')!, A);
		const plan2 = await plugin.prepare('Notes', 'parent');
		const r = await plugin.applyPlan(plan2, all(plan2));
		expect(r.outcomes[0]!.restore).toBe('Frontmatter Link Repair/Restore copies/2026-10-13 101500/Notes/A.md 2.bak');
	});
	it('rejects a second apply while the first runs', async () => {
		const { plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent');
		const first = plugin.applyPlan(plan, all(plan));
		await expect(plugin.applyPlan(plan, all(plan))).rejects.toThrow('in progress');
		await first;
	});
	it('does not scan restore copies or reports again', async () => {
		const { plugin } = setup({ 'Frontmatter Link Repair/Restore copies/x.md': A, [`${REPORT_FOLDER}/r.md`]: A, 'N/a.md': A });
		expect((await plugin.prepare('', 'parent')).files.map((f) => f.path)).toEqual(['N/a.md']);
	});
});

describe('Pro features', () => {
	it('loads a preset in the preview and keeps it after sign out', async () => {
		const { plugin } = setup();
		const pro = fakePro(true);
		await plugin.savePreset('Project notes', 'Notes', 'parent');
		const modal = plugin.openPreview();
		try {
			const load = [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Load');
			expect(load).toBeDefined();
			load!.click();
			expect(modal.folder).toBe('Notes');
			expect(modal.keys).toBe('parent');
			pro.set(false);
			expect(modal.contentEl.querySelector('select')).toBeNull();
			expect(plugin.settings.presets).toEqual([{ name: 'Project notes', folder: 'Notes', keys: 'parent' }]);
		} finally {
			modal.close();
		}
	});
	it('saves, loads and deletes presets only with Pro', async () => {
		const { plugin } = setup();
		expect(await plugin.savePreset('Daily', 'Notes', 'parent')).toBe(false);
		expect(plugin.settings.presets).toEqual([]);
		fakePro(true);
		expect(await plugin.savePreset('Daily', 'Notes', 'parent')).toBe(true);
		expect(await plugin.savePreset('Daily', 'Other', 'up')).toBe(true);
		expect(plugin.settings.presets).toEqual([{ name: 'Daily', folder: 'Other', keys: 'up' }]);
		await expect(plugin.savePreset(' ', 'a', 'b')).rejects.toThrow('name');
		expect(await plugin.deletePreset('Daily')).toBe(true);
		expect(plugin.settings.presets).toEqual([]);
	});
	it('exports the report with skipped files and reasons only with Pro', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Notes', 'parent, parents');
		expect(await plugin.exportReport(plan, null)).toBeNull();
		fakePro(true);
		const result = await plugin.applyPlan(plan, all(plan));
		const file = await plugin.exportReport(plan, result);
		expect(file?.path).toBe(`${REPORT_FOLDER}/Repair report 2026-10-13 101500.md`);
		const text = await read(app, file!.path);
		expect(text).toContain('Notes/Ambig.md, line 2, key parent: Quote or backslash in the link text');
		expect(text).toContain('Notes/A.md: written');
		expect((await plugin.exportReport(plan, result))?.path).toBe(`${REPORT_FOLDER}/Repair report 2026-10-13 101500 2.md`);
	});
});

describe('plugin lifecycle', () => {
	it('loads, adds the command and unloads', async () => {
		const { plugin } = setup();
		const add = vi.spyOn(plugin, 'addCommand');
		await plugin.onload();
		expect(add.mock.calls.map((c) => c[0].id)).toEqual(['show-whats-new', 'send-feedback', 'preview-repair']);
		plugin.onunload();
		expect(isPro()).toBe(false);
	});
});
