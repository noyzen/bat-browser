# Bat Browser

A cross-platform, multi-profile web browser built with Electron. Each tab is a completely isolated session, allowing you to log into multiple accounts on the same site simultaneously.

Features:
- **Isolated Tabs**: Every tab has its own cookies, storage, and cache, powered by Electron's session partitions.
- **Custom UI**: A sleek, space-saving custom titlebar, tab bar, and toolbar.
- **Window State Persistence**: Remembers its size and position across sessions.
- **Packaged**: Includes build scripts for Linux (AppImage) and Windows (NSIS).

## Scripts
- `npm run electron:dev` — Run the app in development mode.
- `npm run electron:build` — Build installers for the current platform.

## Setup
```
npm install
```

## Run
```
npm run electron:dev
```

## Build
```
# Build for your current OS
npm run electron:build
```
