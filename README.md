# NEXUS

NEXUS is a simple portable Windows desktop file manager. It opens in its own app window — no Chrome, no browser tab, and no terminal.

## What it does
- Browse folders and drives from one interface.
- Double-click folders to move into them.
- Use Back and Up to navigate.
- Double-click files to open them in their normal Windows applications.
- Search the current folder.
- Choose any folder using the native Windows folder picker.
- Browse available drive letters, including a USB drive.

## Windows portable build
The GitHub Actions workflow builds a portable Windows executable.

1. Open the repository's **Actions** tab.
2. Select **Build NEXUS for Windows**.
3. Wait for the run to finish successfully.
4. Open the run and download the **NEXUS-Windows-Portable** artifact.
5. Copy the executable to your USB drive and double-click it.

## Notes
- Designed for Windows 10/11 64-bit.
- NEXUS is a file manager, not a replacement for Windows or for the applications that open your files.
- Files open using the programs already installed on the computer.
- The app does not upload or sync your files.
- The portable executable can be stored on a USB drive. Some Electron runtime data may still be stored in the Windows user profile.
