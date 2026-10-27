# Frontmatter Link Repair

Frontmatter Link Repair finds wiki links without quotes in the raw frontmatter of your notes and puts double quotes around them. It shows the old and new line of each match first. You check the matches, select Apply, and the plugin saves a restore copy of each note before it writes the note.

The tests include raw frontmatter such as `parent: [[Some note]]`. The repair changes it to `parent: "[[Some note]]"`. This plugin is for raw files that you wrote by hand or imported.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/repair-flow.gif" alt="Preview the matches, apply the checked ones, then open the repaired note" width="720">

## Features

### Preview with the old and new line

The preview reads the Markdown notes in one folder and its subfolders. For each visible match it shows the note path, the line number, the key, the old line and the new line. Each visible match has a checkbox, and each checkbox starts checked. The preview changes no text.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/preview.png" alt="The repair preview with the old and new line of each match" width="720">

### Only complete links in the keys that you select

You type the top-level keys to repair, for example `parent, parents, up, related`. The plugin changes a value only when the complete value is one wiki link, on the key line or as an item of a simple block list under the key. It keeps the indentation of a list item, the link text, the alias, the heading and the block reference. It does not change other keys or the note body.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/repaired-note.png" alt="The Atlas note after the repair, with quotes around the two links and the same body" width="720">

### Skip ambiguous YAML with a reason

The scanner does not guess. It skips a value and tells you why when the YAML is not simple. Examples are a quote in the link text, a flow list with more than one link, a comment after the link, a nested mapping, a multiline value, a duplicate key, a tab in the indentation and a file without a closing `---` line.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/skipped.png" alt="Skipped parts of two notes with the reason for each one" width="720">

### Restore copy and stale preview check

Before the plugin writes a note, it saves the original text of that note in a new file in the restore copy folder, `Frontmatter Link Repair/Restore copies` by default. Each apply uses a subfolder with the date and time, and the copy keeps the path of the note with the extension `.bak`. If the name is in use, the plugin adds a number. The plugin does not read `.bak` files in the next preview.

When you select Apply, the plugin reads each note again. If the text is not the same as at the preview, it does not write that note and it shows a stale preview warning. The write uses `Vault.process`, which compares the text one more time.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/applied.png" alt="The result after Apply with the restore copy of each note" width="720">

### Saved folder and key presets (Pro)

With Pro, you can save the folder and the keys as a named preset in the preview window, load it later and delete it. Presets stay in the plugin data after sign out, but the preview shows them only while Pro is on.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/pro-presets.png" alt="The saved preset with Load, Delete and Save controls with Pro on" width="720">

### Export the repair report (Pro)

With Pro, Export report writes a new Markdown note in `Frontmatter Link Repair/Reports`. The report lists the folder, the keys, each match with its old and new line, each skipped part with its reason, and the result of each write with its restore copy. Without Pro, the button shows a Sponsor on GitHub notice.

<img src="https://raw.githubusercontent.com/theluckystrike/frontmatter-link-repair/HEAD/docs/report.png" alt="An exported repair report with skipped parts, reasons and restore copies" width="720">

## Install

Open Settings, then Community plugins, then Browse, and search for "Frontmatter Link Repair". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release and put them in `<vault>/.obsidian/plugins/frontmatter-link-repair/`. Reload the community plugins, then turn on Frontmatter Link Repair.

## Usage

1. Make a backup of your vault.
2. Open the command palette and run "Frontmatter Link Repair: Preview the link repair".
3. Type the folder. Leave it empty to read the whole vault.
4. Type the keys, separated by commas.
5. Select Preview. Read the old and new line of each match and the skipped parts.
6. Clear the checkbox of a match that you want to keep as it is.
7. Select Apply checked. The result shows the number of notes written, stale and failed, and the restore copy of each note.

The plugin saves the folder and the keys of the last preview. To undo a write, open the restore copy with a text editor and copy its text back into the note.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

- Folder: the vault folder to read, with its subfolders. Empty means the vault root.
- Keys: the top-level frontmatter keys to repair, separated by commas.
- Restore copy folder: the vault folder for the restore copies.
- Saved presets (Pro): a list of your presets. You save, load and delete them in the preview window.
- Pro: sign in with GitHub, the sponsorship status and the Refresh and Sign out buttons.

## FAQ

### Why quotes and not a YAML list?

The repair puts double quotes around the complete link token. The tests check that the link text stays the same.

### Does it change values that the Properties view already changed?

No. If the Properties view saved `[[A]]` as a nested list, the plugin cannot tell the old link text with certainty, so this version does not rebuild it. A value in flow list format like `[[[A]], [[B]]]` is skipped with a reason.

### Why does it skip a link with a comma or a quote?

YAML reads `[[A, B]]` as a list with two items. A double quote or a backslash in the link text would need an escape inside the new quotes, which changes the text in the file. You can fix them by hand.

### Does it keep my line endings?

Yes. The scanner changes only the matched lines and keeps the line ending of each line, including CRLF. The note body after the closing `---` line is not changed. Unit tests check both.

### What did you not test?

The unit tests use a mock vault. The end-to-end tests pass in Obsidian 1.13.4 and 1.14.4 on macOS. Pro tests use a local sponsorship answer. I did not test a real GitHub sign in, a phone or tablet, or a vault with thousands of notes. I did not measure speed or test files with a byte order mark. Unit tests cover a change between the read and write. I did not run that case with a second plugin in the app. The preview shows up to 200 notes. Apply uses only their checked matches. Choose a smaller folder to review the other notes.

### Can I undo a repair?

There is no restore button in this version. Each restore copy has the original text of the note. Open it with a text editor or rename it to `.md`, then copy the text back.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Frontmatter Link Repair makes no network requests. Sign in uses the GitHub device flow. Frontmatter Link Repair sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Frontmatter Link Repair sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report problems to the publisher, theluckystrike, at notemods.com or through the public repository issues after release. Include the app version, the error text and a small made-up note that shows the problem. Remove private note content and account tokens before you share an example.
