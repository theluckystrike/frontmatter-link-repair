import { Notice, Plugin, TFolder, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { applyMatches, inFolder, matchId, parseKeys, repairText, reportText, type ApplyOutcome, type RepairMatch, type RepairSkip } from './repair';
import { DEFAULT_SETTINGS, FrontmatterLinkRepairSettingTab, MAX_PRESETS, normalizeSettings, type FrontmatterLinkRepairSettings } from './settings';
import { RepairModal } from './ui';

export { matchId };

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due. */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** Pro report export folder. */
export const REPORT_FOLDER = 'Frontmatter Link Repair/Reports';
/** The preview holds at most this many notes with matches or skips. A larger folder gives a notice to scan a smaller folder. */
export const MAX_PLAN_FILES = 2000;

export interface PlanFile {
	path: string;
	/** The text of the note at preview time. A write happens only when the note still has this exact text. */
	original: string;
	matches: RepairMatch[];
	skips: RepairSkip[];
}

export interface RepairPlan {
	folder: string;
	keys: string[];
	/** Number of Markdown notes read. */
	scanned: number;
	/** Notes with at least one match or skip, sorted by path. */
	files: PlanFile[];
	/** True when more notes had matches or skips than MAX_PLAN_FILES. */
	truncated: boolean;
}

export interface ApplyResult {
	outcomes: ApplyOutcome[];
	written: number;
	stale: number;
	failed: number;
}

/** "2026-10-13 101500" in local time, for restore and report names. */
export function fileStamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

class StaleError extends Error {}

export default class FrontmatterLinkRepairPlugin extends Plugin {
	settings: FrontmatterLinkRepairSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The result of the last apply, for the end-to-end test and the report. */
	lastResult: ApplyResult | null = null;
	/** Clock for file names. Tests replace it. */
	now: () => Date = () => new Date();
	private busy = false;
	private settingTab: FrontmatterLinkRepairSettingTab | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new FrontmatterLinkRepairSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addCommand({ id: 'preview-repair', name: 'Preview the link repair', callback: () => void this.openPreview() });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	openPreview(): RepairModal {
		const modal = new RepairModal(this);
		modal.open();
		return modal;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Reads each Markdown note in the folder and finds the matches. Writes nothing. */
	async prepare(folder: string, keysText: string): Promise<RepairPlan> {
		const clean = folder.trim() === '/' ? '' : normalizePath(folder.trim() || '/').replace(/^\/+|\/+$/g, '');
		if (clean !== '' && !(this.app.vault.getAbstractFileByPath(clean) instanceof TFolder)) throw new Error(`No folder with the path "${clean}" in this vault.`);
		const keys = parseKeys(keysText);
		if (keys.length === 0) throw new Error('Type one or more keys, separated by commas.');
		const notes = this.app.vault
			.getMarkdownFiles()
			.filter((f) => inFolder(f.path, clean) && !inFolder(f.path, this.settings.restoreFolder) && !inFolder(f.path, REPORT_FOLDER))
			.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		const files: PlanFile[] = [];
		let truncated = false;
		for (const f of notes) {
			const text = await this.app.vault.read(f);
			const r = repairText(text, keys);
			if (r.matches.length === 0 && r.skips.length === 0) continue;
			if (files.length >= MAX_PLAN_FILES) {
				truncated = true;
				break;
			}
			files.push({ path: f.path, original: text, matches: r.matches, skips: r.skips });
		}
		return { folder: clean, keys, scanned: notes.length, files, truncated };
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const part of path.split('/').filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) await this.app.vault.createFolder(current);
			else if (!(existing instanceof TFolder)) throw new Error(`A file blocks the folder ${current}`);
		}
	}

	/** A path in the restore folder that no file has yet. */
	private uniquePath(base: string, ext: string): string {
		let path = normalizePath(`${base}${ext}`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${base} ${n}${ext}`);
		return path;
	}

	/**
	 * Writes the checked matches. For each note: read it, compare with the preview text, save a restore copy
	 * with the original text, then write the note with Vault.process, which compares the text again.
	 * A note that changed after the preview gets no write.
	 */
	async applyPlan(plan: RepairPlan, checked: ReadonlySet<string>): Promise<ApplyResult> {
		if (this.busy) throw new Error('A repair is in progress.');
		this.busy = true;
		try {
			const stamp = fileStamp(this.now());
			const outcomes: ApplyOutcome[] = [];
			for (const pf of plan.files) {
				const todo = pf.matches.filter((m) => checked.has(matchId(pf.path, m)));
				if (todo.length === 0) continue;
				const file: TFile | null = this.app.vault.getFileByPath(pf.path);
				if (!file) {
					outcomes.push({ path: pf.path, status: 'stale', message: 'the note is missing' });
					continue;
				}
				try {
					const current = await this.app.vault.read(file);
					if (current !== pf.original) throw new StaleError('the note changed after the preview');
					const next = applyMatches(pf.original, todo);
					const restoreBase = `${this.settings.restoreFolder}/${stamp}/${pf.path}`;
					const restore = this.uniquePath(restoreBase, '.bak');
					await this.ensureFolder(restore.slice(0, restore.lastIndexOf('/')));
					await this.app.vault.create(restore, pf.original);
					await this.app.vault.process(file, (data) => {
						if (data !== pf.original) throw new StaleError('the note changed after the preview');
						return next;
					});
					outcomes.push({ path: pf.path, status: 'written', restore });
				} catch (e) {
					if (e instanceof StaleError) outcomes.push({ path: pf.path, status: 'stale', message: e.message });
					else outcomes.push({ path: pf.path, status: 'failed', message: e instanceof Error ? e.message : String(e) });
				}
			}
			const result: ApplyResult = {
				outcomes,
				written: outcomes.filter((o) => o.status === 'written').length,
				stale: outcomes.filter((o) => o.status === 'stale').length,
				failed: outcomes.filter((o) => o.status === 'failed').length,
			};
			this.lastResult = result;
			new Notice(`Frontmatter link repair: ${result.written} notes written, ${result.stale} stale, ${result.failed} failed.`);
			if (result.stale) new Notice(`Stale preview: ${result.stale} notes changed after the preview and got no write. Preview again.`);
			return result;
		} finally {
			this.busy = false;
		}
	}

	/** Pro: saves or replaces a preset. Returns false without Pro. */
	async savePreset(name: string, folder: string, keys: string): Promise<boolean> {
		if (!isPro()) return false;
		const n = name.trim();
		if (!n) throw new Error('Type a preset name.');
		const others = this.settings.presets.filter((p) => p.name !== n);
		if (others.length >= MAX_PRESETS) throw new Error(`You can save ${MAX_PRESETS} presets. Delete a preset first.`);
		this.settings = normalizeSettings({ ...this.settings, presets: [...others, { name: n, folder, keys }] });
		await this.saveSettings();
		return true;
	}

	/** Pro: deletes a preset by name. */
	async deletePreset(name: string): Promise<boolean> {
		if (!isPro()) return false;
		this.settings.presets = this.settings.presets.filter((p) => p.name !== name);
		await this.saveSettings();
		return true;
	}

	/** Pro: writes the repair report as a new note in REPORT_FOLDER. */
	async exportReport(plan: RepairPlan, result: ApplyResult | null): Promise<TFile | null> {
		if (!isPro()) {
			new Notice('Report export needs a GitHub sponsorship. Open the plugin settings to sign in.');
			return null;
		}
		const stamp = fileStamp(this.now());
		await this.ensureFolder(REPORT_FOLDER);
		const path = this.uniquePath(`${REPORT_FOLDER}/Repair report ${stamp}`, '.md');
		const file = await this.app.vault.create(path, reportText(plan.folder, plan.keys, plan.files, result?.outcomes ?? [], stamp));
		new Notice(`Saved the repair report to ${file.path}`);
		return file;
	}
}
