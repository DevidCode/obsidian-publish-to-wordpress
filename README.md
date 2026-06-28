# Publish to WordPress

Publish the active Obsidian note as a **WordPress draft** — directly via the WordPress REST API, or through a custom webhook (e.g. n8n).

Write in Obsidian, click once, get a draft in WordPress — no copy-paste.

## Features

- Ribbon icon + commands to publish the active note as a **draft**.
- **WordPress REST backend** (default): uses **Application Passwords** — nothing to install on the WordPress side.
- Optional **custom-webhook backend** for advanced pipelines (queue, multi-target, n8n…).
- Converts the note body to HTML and attaches a **featured image** (frontmatter `image:` or the first embedded image).

## Getting started (WordPress backend)

### 1. Create an Application Password in WordPress
In WordPress admin: **Users → Profile → Application Passwords** → type a name (e.g. `Obsidian`) → **Add new application password** → copy the generated password.

> Requires **HTTPS** — Application Passwords are rejected over plain HTTP.

### 2. Configure the plugin
**Settings → Publish to WordPress**:
- **Backend**: `WordPress (direct REST)`
- **Site URL**: `https://your-site.com`
- **Username**: your WordPress login (not your email)
- **Application password**: the one you just generated (with or without spaces)

### 3. Write a note and publish
Add a marker line to your note (default `**Post final :**`); everything **after** it becomes the post body:

```markdown
**Post final :**

First paragraph.

Second paragraph.
```

Then click the **ribbon icon → Draft to WordPress** (or run the command *Publish current note as draft*). A draft appears in your WordPress admin.

- **Title** = frontmatter `wp_title`, otherwise the note's file name.
- **Featured image** = frontmatter `image:`, otherwise the first embedded image in the note.

## Troubleshooting

### `Request failed, status 401`
Authentication was rejected. Two common causes:

1. **Wrong username / application password.** The username is your WordPress *login*, not your email.

2. **Your host strips the `Authorization` header.** Common on shared hosting with Apache + PHP-FastCGI (e.g. some OVH plans). Application Passwords travel in that header, so if it's stripped, auth always fails. Add this to your site's **root `.htaccess`**, *above* the `# BEGIN WordPress` line:

   ```apache
   SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
   <IfModule mod_rewrite.c>
   RewriteEngine On
   RewriteCond %{HTTP:Authorization} .
   RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
   </IfModule>
   ```

   Then retry.

## Custom webhook backend (advanced)

Switch the backend to **Custom webhook** and set your endpoint URL(s). The plugin POSTs a JSON payload to your automation (e.g. an n8n workflow):

- *Draft* action → `{ title, content, status: "draft", image_b64?, image_name?, image_mime? }`
- *Queue* action → `{ targets, wp_title, wp_content, image_b64?, … }` where `targets` comes from the frontmatter `cibles`.

## How the note is read

- The body is taken **after the marker** (configurable in settings).
- Lines starting with `### Bloc` are ignored; blank-line-separated blocks become `<p>…</p>`; `*(…)*` becomes `<em>…</em>`.

## License

[MIT](LICENSE)
