# Buffalo Machines Staff Hub

Internal staff app. Login only, with no public sign-up. Staff accounts are created in Supabase.

## Run it on your own computer

One-time setup:
1. Install **Node.js** (the "LTS" version) from https://nodejs.org.
2. Install **GitHub Desktop** from https://desktop.github.com and sign in.
3. In GitHub Desktop: **File › Clone repository**, pick this repository, then click **Clone**.
4. In the project folder, copy `.env.example` to a new file called `.env.local`. Fill in the Supabase Project URL and the **public** key.

Each time you want to try it:
1. In GitHub Desktop, click **Fetch origin**, then **Pull origin**. This gets the latest changes.
2. Click **Repository › Open in Terminal** (on Windows: **Open in Command Prompt**) and type:
   ```
   npm install
   npm run dev
   ```
3. Open http://localhost:5173 in your browser. Press `Ctrl + C` in the terminal to stop it.

## Leaving feedback with Agentation

When the app runs on your computer, a small round button appears in the bottom-right corner. Click it, click anything on the page, type your comment, then click **Copy**. Paste the copied text into the chat with Claude.

This button never appears on the live site.

## Branding

- Logo and app name: `src/brand.ts`
- Colours: the `@theme` block at the top of `src/index.css`
