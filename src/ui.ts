import { Modal, Setting } from 'obsidian';
import type FrontmatterLinkRepairPlugin from './main';
import type { ApplyResult, RepairPlan } from './main';
import { matchId } from './repair';
import { isPro, onProChange } from './pro';

/** The preview shows this many notes. Only matches in these notes start checked. */
export const SHOW_FILES = 200;
/** Suffix of each Pro label. */
const PRO = ' (Pro)';

export class RepairModal extends Modal {
	plan: RepairPlan | null = null;
	result: ApplyResult | null = null;
	/** Ids of the checked matches. Each visible match starts checked. */
	readonly checked = new Set<string>();
	folder: string;
	keys: string;
	private serial = 0;
	private isOpen = false;
	private offPro: (() => void) | null = null;
	private previewEl: HTMLElement | null = null;

	constructor(private plugin: FrontmatterLinkRepairPlugin) {
		super(plugin.app);
		this.folder = plugin.settings.folder;
		this.keys = plugin.settings.keys;
	}

	onOpen(): void {
		this.isOpen = true;
		this.setTitle('Frontmatter link repair');
		this.modalEl.addClass('flr-modal');
		this.offPro = onProChange(() => this.draw());
		this.draw();
	}

	onClose(): void {
		this.isOpen = false;
		this.serial++;
		this.offPro?.();
		this.offPro = null;
		this.contentEl.empty();
	}

	private reset(): void {
		this.plan = null;
		this.result = null;
		this.checked.clear();
		this.serial++;
		this.previewEl?.empty();
	}

	draw(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('flr-repair');
		el.createEl('p', { text: 'Find complete wiki links without quotes in the selected frontmatter keys. Check the old and new lines, then apply. Each note gets a restore copy before the write.' });
		new Setting(el)
			.setName('Folder')
			.setDesc('Vault folder with its subfolders. Leave empty for the vault root.')
			.addText((t) =>
				t.setValue(this.folder).onChange((v) => {
					this.folder = v;
					this.reset();
				}),
			);
		new Setting(el)
			.setName('Keys')
			.setDesc('Top-level keys, separated by commas.')
			.addText((t) =>
				t.setValue(this.keys).onChange((v) => {
					this.keys = v;
					this.reset();
				}),
			);
		this.drawPresets(el);
		new Setting(el).addButton((b) =>
			b
				.setButtonText('Preview')
				.setCta()
				.onClick(() => void this.runPreview()),
		);
		this.previewEl = el.createDiv({ cls: 'flr-preview' });
		if (this.plan) this.showPlan();
	}

	private drawPresets(el: HTMLElement): void {
		const pro = isPro();
		const presets = this.plugin.settings.presets;
		if (!pro) {
			new Setting(el).setName(`Presets${PRO}`).setDesc('Pro saves and loads folder and key presets.');
			return;
		}
		let chosen = presets[0]?.name ?? '';
		let name = '';
		new Setting(el)
			.setName(`Presets${PRO}`)
			.addDropdown((d) => {
				for (const p of presets) d.addOption(p.name, p.name);
				if (presets.length === 0) d.addOption('', 'No presets');
				d.setValue(chosen).onChange((v) => (chosen = v));
			})
			.addButton((b) =>
				b
					.setButtonText('Load')
					.setDisabled(presets.length === 0)
					.onClick(() => {
						const p = this.plugin.settings.presets.find((x) => x.name === chosen);
						if (!p) return;
						this.folder = p.folder;
						this.keys = p.keys;
						this.reset();
						this.draw();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText('Delete')
					.setDisabled(presets.length === 0)
					.onClick(async () => {
						await this.plugin.deletePreset(chosen);
						this.draw();
					}),
			);
		new Setting(el)
			.setName(`Save as preset${PRO}`)
			.addText((t) => t.setPlaceholder('Preset name').onChange((v) => (name = v)))
			.addButton((b) =>
				b.setButtonText('Save').onClick(async () => {
					try {
						await this.plugin.savePreset(name, this.folder, this.keys);
						this.draw();
					} catch (e) {
						this.previewEl?.setText(e instanceof Error ? e.message : String(e));
					}
				}),
			);
	}

	async runPreview(): Promise<RepairPlan | null> {
		const serial = ++this.serial;
		this.plan = null;
		this.result = null;
		this.checked.clear();
		this.previewEl?.setText('Reading notes…');
		try {
			const plan = await this.plugin.prepare(this.folder, this.keys);
			if (!this.isOpen || serial !== this.serial) return null;
			this.plan = plan;
			for (const f of plan.files.slice(0, SHOW_FILES)) for (const m of f.matches) this.checked.add(matchId(f.path, m));
			this.plugin.settings.folder = this.folder;
			this.plugin.settings.keys = this.keys;
			await this.plugin.saveSettings();
			if (this.isOpen && serial === this.serial) this.showPlan();
			return plan;
		} catch (e) {
			if (this.isOpen && serial === this.serial) this.previewEl?.setText(e instanceof Error ? e.message : String(e));
			return null;
		}
	}

	private showPlan(): void {
		const el = this.previewEl;
		const plan = this.plan;
		if (!el || !plan) return;
		el.empty();
		const matches = plan.files.reduce((n, f) => n + f.matches.length, 0);
		const skips = plan.files.reduce((n, f) => n + f.skips.length, 0);
		const withMatches = plan.files.filter((f) => f.matches.length).length;
		el.createEl('p', { cls: 'flr-summary', text: `${matches} matches in ${withMatches} notes · ${skips} skipped parts · ${plan.scanned} notes read` });
		if (plan.truncated) el.createEl('p', { cls: 'flr-warning', text: 'The folder has too many notes for one preview. Choose a smaller folder.' });
		const list = el.createDiv({ cls: 'flr-list' });
		for (const f of plan.files.slice(0, SHOW_FILES)) {
			const box = list.createDiv({ cls: 'flr-file' });
			box.createDiv({ cls: 'flr-path', text: f.path });
			for (const m of f.matches) {
				const id = matchId(f.path, m);
				const row = box.createEl('label', { cls: 'flr-match' });
				const cb = row.createEl('input', { type: 'checkbox' });
				cb.checked = this.checked.has(id);
				cb.dataset.match = id;
				cb.addEventListener('change', () => {
					if (cb.checked) this.checked.add(id);
					else this.checked.delete(id);
				});
				const lines = row.createDiv({ cls: 'flr-lines' });
				lines.createDiv({ cls: 'flr-line-no', text: `Line ${m.line}, ${m.key}` });
				lines.createEl('code', { cls: 'flr-old', text: m.old });
				lines.createEl('code', { cls: 'flr-new', text: m.new });
			}
			for (const s of f.skips) box.createDiv({ cls: 'flr-skip', text: `Skipped${s.line ? ` line ${s.line}` : ''}${s.key ? `, ${s.key}` : ''}: ${s.reason}` });
		}
		if (plan.files.length > SHOW_FILES) el.createEl('p', { text: `The preview shows the first ${SHOW_FILES} notes. Apply uses only checked matches in these notes. Choose a smaller folder to review the other notes.` });
		const actions = new Setting(el).addButton((b) =>
			b
				.setButtonText('Apply checked')
				.setCta()
				.setDisabled(matches === 0 || this.result !== null)
				.onClick(async () => {
					b.setDisabled(true);
					await this.runApply();
				}),
		);
		actions.addButton((b) =>
			b
				.setButtonText(`Export report${PRO}`)
				.setDisabled(!isPro())
				.onClick(async () => {
					if (this.plan) await this.plugin.exportReport(this.plan, this.result);
				}),
		);
		this.resultEl = el.createDiv({ cls: 'flr-result' });
		if (this.result) this.showResult(this.result);
	}

	private resultEl: HTMLElement | null = null;

	async runApply(): Promise<ApplyResult | null> {
		if (!this.plan) return null;
		try {
			const result = await this.plugin.applyPlan(this.plan, this.checked);
			this.result = result;
			if (this.isOpen) this.showResult(result);
			return result;
		} catch (e) {
			this.resultEl?.setText(e instanceof Error ? e.message : String(e));
			return null;
		}
	}

	private showResult(result: ApplyResult): void {
		const el = this.resultEl;
		if (!el) return;
		el.empty();
		el.createEl('p', { cls: 'flr-done', text: `${result.written} notes written, ${result.stale} stale, ${result.failed} failed.` });
		if (result.stale) el.createEl('p', { cls: 'flr-warning flr-stale', text: 'Stale preview: some notes changed after the preview. They got no write. Preview again.' });
		for (const o of result.outcomes) {
			if (o.status === 'written') el.createDiv({ text: `${o.path}: restore copy ${o.restore ?? ''}` });
			else el.createDiv({ cls: 'flr-warning', text: `${o.path}: ${o.status}, ${o.message ?? ''}` });
		}
	}
}
