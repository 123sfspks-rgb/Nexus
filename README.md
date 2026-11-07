# NEXUS Desktop

A local-first Windows workspace with a native PowerShell terminal.

## Features
- Desktop window; no browser tab or web hosting.
- Real PowerShell session through `node-pty` on Windows.
- Local folder listing and opening files with their default Windows apps.
- xterm.js terminal interface.
- No account, cloud service, or network connection required at runtime.

## Requirements
- Windows 10/11, 64-bit
- Node.js LTS and npm
- C++ Build Tools / Python may be needed by node-pty when installing native dependencies.

## Run from source
```powershell
npm install
npm start
```

## Build a portable Windows executable
Run this on a Windows computer:
```powershell
npm install
npm run dist:win
```
The portable executable will be created in `dist\`.

## Important
The terminal runs commands as the currently signed-in Windows user. It is not a sandbox or security boundary. Only run commands you understand. The portable executable does not bundle a complete Node.js development toolchain or Python; those tools must already be installed on the computer if you want to use them in the terminal.

## USB use
Copy the built `NEXUS-1.0.0-Windows-Portable.exe` to your USB drive. Keep the NEXUS project folder and your own workspace folders alongside it. A portable Electron app may still write temporary/runtime data to the Windows user profile.
