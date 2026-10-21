import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type FrontmatterLinkRepairPlugin from './main';
import { helloSettingItems } from './hello/settings';

/** Pro: one saved folder and key list. */
export interface Preset {
	name: string;
	folder: string;
	keys: string;
}

export interface FrontmatterLinkRepairSettings {
	/** Vault folder to scan. '' = the vault root. */
	folder: string;
	/** Comma separated top-level frontmatter keys. */
	keys: string;
	/** Vault folder for restore copies. */
	restoreFolder: string;
	/** Pro: saved presets. Kept after sign out, used only while Pro is on. */
	presets: Preset[];
}

export const DEFAULT_SETTINGS: FrontmatterLinkRepairSettings = {
	folder: '',
	keys: 'parent, parents, up, related',
	restoreFolder: 'Frontmatter Link Repair/Restore copies',
	presets: [],
};

export const MAX_PRESETS = 20;

function str(v: unknown, d: string, max = 2000): string {
	return typeof v === 'string' && v.length <= max ? v : d;
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json does not break the plugin. */
export function normalizeSettings(saved: unknown): FrontmatterLinkRepairSettings {
	const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof FrontmatterLinkRepairSettings, unknown>>;
	const presets: Preset[] = [];
	if (Array.isArray(s.presets)) {
		for (const p of s.presets as unknown[]) {
			if (!p || typeof p !== 'object') continue;
			const r = p as Record<string, unknown>;
			const name = str(r.name, '', 100).trim();
			if (!name || presets.some((x) => x.name === name) || presets.length >= MAX_PRESETS) continue;
			presets.push({ name, folder: str(r.folder, ''), keys: str(r.keys, DEFAULT_SETTINGS.keys) });
		}
	}
	const restore = str(s.restoreFolder, DEFAULT_SETTINGS.restoreFolder).trim();
	return {
		folder: str(s.folder, DEFAULT_SETTINGS.folder),
		keys: str(s.keys, DEFAULT_SETTINGS.keys),
		restoreFolder: restore.replace(/^\/+|\/+$/g, '') === '' ? DEFAULT_SETTINGS.restoreFolder : restore,
		presets,
	};
}

export class FrontmatterLinkRepairSettingTab extends PluginSettingTab {
	plugin: FrontmatterLinkRepairPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: FrontmatterLinkRepairPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const presets = this.plugin.settings.presets;
		return [
			{
				name: 'Folder',
				desc: 'Vault folder to scan, with its subfolders. Leave empty to scan the vault root.',
				control: { type: 'folder', key: 'folder', defaultValue: DEFAULT_SETTINGS.folder, includeRoot: true },
			},
			{
				name: 'Keys',
				desc: 'Top-level frontmatter keys to repair, separated by commas. Other keys stay as they are.',
				control: { type: 'text', key: 'keys', defaultValue: DEFAULT_SETTINGS.keys },
			},
			{
				name: 'Restore copy folder',
				desc: 'Vault folder for the restore copies. Each copy has the original text of a note before the write, with the extension .bak.',
				control: { type: 'text', key: 'restoreFolder', defaultValue: DEFAULT_SETTINGS.restoreFolder },
			},
			{
				type: 'group',
				heading: 'Saved presets (Pro)',
				items: [
					{
						name: 'Saved presets (Pro)',
						desc: presets.length
							? `${presets.map((p) => `${p.name} (${p.folder || 'vault root'}: ${p.keys})`).join('; ')}. Save, load and delete presets in the repair preview.`
							: 'No presets yet. With Pro, save a folder and key preset in the repair preview.',
					},
				],
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: saved folder and key presets, and export of the repair report.'
					: 'Free version: scan, preview, restore copies and checked writes. Pro adds saved folder and key presets, and export of the repair report with skipped files and reasons.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== 'folder' && key !== 'keys' && key !== 'restoreFolder') return;
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveSettings();
	}
}
