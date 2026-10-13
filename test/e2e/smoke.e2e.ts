import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('opens the repair preview through the command', async function () {
		await browser.executeObsidianCommand(`${pluginId}:preview-repair`);
		const modal = browser.$('.flr-repair');
		await modal.waitForDisplayed({ timeout: 30000 });
		expect(await modal.$('button=Preview').isExisting()).toBe(true);
		await browser.keys('Escape');
		await modal.waitForExist({ reverse: true, timeout: 30000 });
	});
});
