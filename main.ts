import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
	Menu,
	requestUrl,
	arrayBufferToBase64,
} from "obsidian";

interface PublishSettings {
	backend: "wordpress" | "webhook";
	wpSiteUrl: string;
	wpUsername: string;
	wpAppPassword: string;
	webhookDraftUrl: string;
	webhookQueueUrl: string;
	postFinalMarker: string;
}

const DEFAULT_SETTINGS: PublishSettings = {
	backend: "wordpress",
	wpSiteUrl: "",
	wpUsername: "",
	wpAppPassword: "",
	webhookDraftUrl: "",
	webhookQueueUrl: "",
	postFinalMarker: "**Post final :**",
};

interface ParsedNote {
	title: string;
	html: string;
	cibles: string[];
	imageFile: TFile | null;
}

function mimeForExtension(ext: string): string {
	switch (ext.toLowerCase()) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		case "gif":
			return "image/gif";
		default:
			return "application/octet-stream";
	}
}

export default class PublishToWordPressPlugin extends Plugin {
	settings: PublishSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("upload", "Publish to WordPress", (evt: MouseEvent) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Draft to WordPress")
					.setIcon("file-text")
					.onClick(() => this.publishDraft())
			);
			if (this.settings.backend === "webhook") {
				menu.addItem((item) =>
					item
						.setTitle("Queue to targets (cibles)")
						.setIcon("calendar")
						.onClick(() => this.queueTargets())
				);
			}
			menu.showAtMouseEvent(evt);
		});

		this.addCommand({
			id: "publish-draft",
			name: "Publish current note as draft",
			callback: () => this.publishDraft(),
		});

		this.addCommand({
			id: "queue-targets",
			name: "Queue current note to targets (webhook)",
			callback: () => this.queueTargets(),
		});

		this.addSettingTab(new PublishSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async parseActiveNote(): Promise<ParsedNote | null> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active note.");
			return null;
		}
		const raw = await this.app.vault.read(file);
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

		const marker = this.settings.postFinalMarker;
		const idx = raw.indexOf(marker);
		if (idx === -1) {
			new Notice(`Marker not found in note: ${marker}`);
			return null;
		}

		const post = raw.slice(idx + marker.length);
		const lines = post.split("\n").filter((l) => !l.trim().startsWith("### Bloc"));
		const bodyTxt = lines
			.join("\n")
			.trim()
			.replace(/\*\(([^*]*)\)\*/g, "<em>($1)</em>")
			.replace(/&/g, "&amp;");
		const paras = bodyTxt
			.split(/\n\s*\n/)
			.map((p) => p.trim())
			.filter(Boolean);
		const html = paras.map((p) => "<p>" + p.replace(/\n/g, "<br>\n") + "</p>").join("\n");

		const title =
			(fm.wp_title as string) || file.basename.replace(/^Sujet — /, "");

		let cibles: string[] = [];
		if (fm.cibles) {
			cibles = Array.isArray(fm.cibles)
				? fm.cibles.map(String)
				: [String(fm.cibles)];
		}

		let imageName: string | null = fm.image
			? String(fm.image).replace(/^\[\[|\]\]$/g, "")
			: null;
		if (!imageName) {
			const m = raw.match(/!\[\[([^\]]+\.(?:png|jpe?g|webp|gif))\]\]/i);
			if (m) imageName = m[1];
		}

		let imageFile: TFile | null = null;
		if (imageName) {
			imageFile = this.app.metadataCache.getFirstLinkpathDest(imageName, file.path);
		}

		return { title, html, cibles, imageFile };
	}

	async publishDraft() {
		const note = await this.parseActiveNote();
		if (!note) return;
		if (this.settings.backend === "wordpress") {
			await this.publishToWordPress(note);
		} else {
			await this.publishViaWebhook(note);
		}
	}

	async publishToWordPress(note: ParsedNote) {
		const { wpSiteUrl, wpUsername, wpAppPassword } = this.settings;
		if (!wpSiteUrl || !wpUsername || !wpAppPassword) {
			new Notice(
				"Configure WordPress site URL, username and application password in settings."
			);
			return;
		}
		const base = wpSiteUrl.replace(/\/+$/, "");
		const auth = "Basic " + btoa(`${wpUsername}:${wpAppPassword}`);
		new Notice("Publishing draft to WordPress…");
		try {
			let featuredMedia: number | undefined;
			if (note.imageFile) {
				const bin = await this.app.vault.readBinary(note.imageFile);
				const mediaRes = await requestUrl({
					url: `${base}/wp-json/wp/v2/media`,
					method: "POST",
					headers: {
						Authorization: auth,
						"Content-Type": mimeForExtension(note.imageFile.extension),
						"Content-Disposition": `attachment; filename="${note.imageFile.name}"`,
					},
					body: bin,
				});
				featuredMedia = (mediaRes.json as { id?: number } | undefined)?.id;
			}
			const body: Record<string, unknown> = {
				title: note.title,
				content: note.html,
				status: "draft",
			};
			if (featuredMedia) body.featured_media = featuredMedia;
			const res = await requestUrl({
				url: `${base}/wp-json/wp/v2/posts`,
				method: "POST",
				headers: { Authorization: auth, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const created = res.json as { id?: number } | undefined;
			new Notice(`✅ Draft created (id ${created?.id ?? "?"}).`);
		} catch (e) {
			new Notice("⛔ " + (e instanceof Error ? e.message : String(e)));
		}
	}

	async publishViaWebhook(note: ParsedNote) {
		const url = this.settings.webhookDraftUrl;
		if (!url) {
			new Notice("Configure the draft webhook URL in settings.");
			return;
		}
		new Notice("Posting draft to webhook…");
		try {
			const payload = await this.withImage(
				{ title: note.title, content: note.html, status: "draft" },
				note
			);
			const res = await requestUrl({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const sent = res.json as { id?: number } | undefined;
			new Notice(`✅ Sent (id ${sent?.id ?? "?"}).`);
		} catch (e) {
			new Notice("⛔ " + (e instanceof Error ? e.message : String(e)));
		}
	}

	async queueTargets() {
		if (this.settings.backend !== "webhook") {
			new Notice("Queue is only available in webhook mode.");
			return;
		}
		const note = await this.parseActiveNote();
		if (!note) return;
		if (!note.cibles.length) {
			new Notice("No 'cibles' in frontmatter.");
			return;
		}
		const url = this.settings.webhookQueueUrl;
		if (!url) {
			new Notice("Configure the queue webhook URL in settings.");
			return;
		}
		new Notice("Queuing…");
		try {
			const payload = await this.withImage(
				{ targets: note.cibles, wp_title: note.title, wp_content: note.html },
				note
			);
			await requestUrl({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			new Notice(`✅ Queued (${note.cibles.join(", ")}).`);
		} catch (e) {
			new Notice("⛔ " + (e instanceof Error ? e.message : String(e)));
		}
	}

	async withImage(
		payload: Record<string, unknown>,
		note: ParsedNote
	): Promise<Record<string, unknown>> {
		if (note.imageFile) {
			const bin = await this.app.vault.readBinary(note.imageFile);
			payload.image_b64 = arrayBufferToBase64(bin);
			payload.image_name = note.imageFile.name;
			payload.image_mime = mimeForExtension(note.imageFile.extension);
		}
		return payload;
	}
}

class PublishSettingTab extends PluginSettingTab {
	plugin: PublishToWordPressPlugin;

	constructor(app: App, plugin: PublishToWordPressPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Backend")
			.setDesc("How notes are published.")
			.addDropdown((d) =>
				d
					.addOption("wordpress", "WordPress (direct REST)")
					.addOption("webhook", "Custom webhook (n8n…)")
					.setValue(this.plugin.settings.backend)
					.onChange(async (v) => {
						this.plugin.settings.backend = v as "wordpress" | "webhook";
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.backend === "wordpress") {
			new Setting(containerEl)
				.setName("WordPress site URL")
				.setDesc("e.g. https://example.com")
				.addText((t) =>
					t.setValue(this.plugin.settings.wpSiteUrl).onChange(async (v) => {
						this.plugin.settings.wpSiteUrl = v.trim();
						await this.plugin.saveSettings();
					})
				);
			new Setting(containerEl).setName("Username").addText((t) =>
				t.setValue(this.plugin.settings.wpUsername).onChange(async (v) => {
					this.plugin.settings.wpUsername = v.trim();
					await this.plugin.saveSettings();
				})
			);
			new Setting(containerEl)
				.setName("Application password")
				.setDesc("WordPress → Users → Profile → Application Passwords.")
				.addText((t) => {
					t.setValue(this.plugin.settings.wpAppPassword).onChange(async (v) => {
						this.plugin.settings.wpAppPassword = v.trim();
						await this.plugin.saveSettings();
					});
					t.inputEl.type = "password";
				});
		} else {
			new Setting(containerEl).setName("Draft webhook URL").addText((t) =>
				t.setValue(this.plugin.settings.webhookDraftUrl).onChange(async (v) => {
					this.plugin.settings.webhookDraftUrl = v.trim();
					await this.plugin.saveSettings();
				})
			);
			new Setting(containerEl).setName("Queue webhook URL").addText((t) =>
				t.setValue(this.plugin.settings.webhookQueueUrl).onChange(async (v) => {
					this.plugin.settings.webhookQueueUrl = v.trim();
					await this.plugin.saveSettings();
				})
			);
		}

		new Setting(containerEl)
			.setName("« Post final » marker")
			.setDesc("The note body is read after this text.")
			.addText((t) =>
				t.setValue(this.plugin.settings.postFinalMarker).onChange(async (v) => {
					this.plugin.settings.postFinalMarker = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
