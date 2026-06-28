# Publish to WordPress

Publish the active Obsidian note as a **WordPress draft** — directly via the WordPress REST API, or through a custom webhook (e.g. n8n).

## Features

- Ribbon icon + commands to publish the active note as a **draft**.
- **WordPress REST backend** (default): uses **Application Passwords** — no server-side plugin needed.
- Optional **custom-webhook backend** for advanced pipelines (queue / multi-target).
- Reads the note body after a configurable marker, converts it to HTML, and attaches a **featured image** (frontmatter `image:` or the first embedded image).

## Setup — WordPress backend

1. In WordPress: **Users → Profile → Application Passwords** → generate one.
2. In the plugin settings: **site URL**, **username**, **application password**.
3. Open a note → click the ribbon icon → **Draft to WordPress**.

> Requires HTTPS on your WordPress site (Application Passwords are rejected over plain HTTP).

## Setup — Custom webhook backend (advanced)

Switch the backend to *Custom webhook* and set your endpoint URLs. The plugin POSTs a JSON payload (`title`, `content`, `status`, optional base64 image, and `targets` for the queue action) to your automation (e.g. n8n).

## How the note is read

- The body is taken **after a marker** (default `**Post final :**`, configurable).
- Lines starting with `### Bloc` are ignored; paragraphs become `<p>…</p>`.
- Title = frontmatter `wp_title`, otherwise the file name.
- Featured image = frontmatter `image:` or the first embedded image.

## License

[MIT](LICENSE)
