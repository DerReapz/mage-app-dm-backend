# Mage DM Dashboard

Storyteller-side companion app for the [self-attempt-maging-app](https://github.com/DerReapz/self-attempt-maging-app) player app. Lets a DM view their players' live character sheets over Supabase.

## Architecture

```
┌────────────────┐  push on save  ┌──────────┐  realtime  ┌────────────────┐
│ Player app     │ ─────────────▶ │ Supabase │ ─────────▶ │ DM Dashboard   │
│ (forked)       │                │ Postgres │            │ (this repo)    │
└────────────────┘                └──────────┘            └────────────────┘
```

- **Auth**: email + password via Supabase Auth.
- **Schema**: `profiles`, `game_sessions`, `session_members`, `characters` (see [`supabase/schema.sql`](../supabase/schema.sql)).
- **RLS**: DM only sees their session's characters; players only see their own.
- **Live**: Realtime subscription on `characters` reflects edits within seconds.

## First-time setup

### 1. Supabase project

1. Create a project at https://supabase.com.
2. SQL editor → paste [`supabase/schema.sql`](../supabase/schema.sql) → Run.
3. Authentication → Providers → enable **Email**. For initial testing, turn **"Confirm email"** off so signups are immediate; turn it back on for production.
4. Copy the project URL and the **anon** (publishable) key.

### 2. Local dev

```bash
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 3. Android APK

The repo ships a GitHub Action that builds a debug APK on every push to `main`.

Repo **Settings → Secrets and variables → Actions** must contain:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

After the workflow runs, the APK is under **Actions → latest run → Artifacts → `mage-dm-dashboard-debug`**.

To build locally instead:

```bash
npm run build
npx cap add android      # only the first time
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Repo layout

```
src/
  App.jsx                       top-level routing
  lib/supabase.js               Supabase client + ensureProfile helper
  data/defaultSheet.js          schema mirror of the player app
  context/ThemeContext.jsx      "Mage" gold-on-black theme
  components/SharedUI.jsx       Card, Header, Toast, GoldButton
  screens/
    LoginScreen.jsx             sign in / sign up
    SessionsListScreen.jsx      DM's chronicles + create
    SessionDetailScreen.jsx     list of (player, character)
    CharacterSheetView.jsx      read-only sheet render
.github/workflows/build-apk.yml CI build for debug APK
capacitor.config.json           appId, webDir
```

## Status

- [x] Schema & RLS
- [x] DM auth + sessions list + invite codes
- [x] Session detail (player + character list) with live realtime
- [x] Read-only character sheet view
- [ ] Player-app fork: auth, "Join session by invite code", debounced sync-on-save (separate repo)
- [ ] Offline / conflict handling beyond last-write-wins
