# Teaching Games — Game Theory Interactive Tool

Lightweight React app for teaching 2-player simultaneous games (student view, instructor/admin view, and a public screen).

## Quick overview

- Student view: default route — players join a game and play rounds.
- Instructor view: protected admin UI at /admin — start/reset games, manage rounds, enable/disable public screen.
- Screen view: public projector page at /screen — shows game code while active and full results after a game concludes.

## Getting started (local)

1. Copy environment variables into `.env.local`:
   - VITE_FIREBASE_API_KEY
   - VITE_ADMIN_GH_USERNAME
   - VITE_ADMIN_UID (recommended)
2. Install and run:
   - npm install
   - npm run dev
3. Open http://localhost:5173/ (student), http://localhost:5173/admin (instructor), http://localhost:5173/screen (public screen)

## Firebase requirements

- Enable GitHub sign-in provider in Firebase Auth and add authorized domains (localhost, your GitHub Pages domain, the firebaseapp/web.app domains).
- Configure your Google Cloud API key referrer rules to allow your origins used for auth.
- Secure Realtime Database rules so only the instructor UID can write game state (see code comments).

## Deployment notes

- Vite base is set for the GitHub Pages project path (e.g. `/teaching-games/`) in `vite.config.js`.
- Builds with `npm run build`. A workflow is included to deploy via GitHub Actions.

## Privacy & security

- Instructor actions are gated by Firebase Auth and verified against the configured admin UID/username.
- Realtime Database rules should enforce server‑side write restrictions — do not rely on client checks alone.

## Files of interest

- src/App.jsx — main routing and views
- src/InstructorView / StudentView (inside App.jsx) — view logic
- src/ScreenView.jsx — public screen shown at /screen
- src/firebase.js — firebase initialization
- src/useAdminAuth.js — GitHub auth helper

## Short support

- If auth popups fail, confirm Firebase Authorized Domains and API key referrer rules include your current origin(s).
- For help updating env vars or DB rules, inspect `src/useAdminAuth.js` and `src/firebase.js`.
