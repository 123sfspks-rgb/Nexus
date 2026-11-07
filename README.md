# NEXUS Desktop

A local-first Windows workspace with a native PowerShell terminal.

## Features
- Standalone Electron desktop window; no browser tab or web hosting.
- Real PowerShell session through `node-pty` on Windows.
- Local file explorer with a native folder picker.
- Open files and folders with their default Windows applications.
- xterm.js terminal interface.
- No account, cloud service, or network connection required at runtime.

## Build a portable Windows executable

The repository includes a GitHub Actions workflow. Open the **Actions** tab and run **Build NEXUS for Windows** (or push a source change). When it finishes, open the workflow run and download the `NEXUS-Windows-Portable` artifact.

To build locally on Windows 10/11:
```powershell
npm install
npm run dist:win
```
The executable is created in `dist\`.

## Requirements and limitations
- Windows 10/11, 64-bit.
- The build uses Electron and node-pty. Native dependency installation may require Windows build tools if building locally.
- The terminal runs commands as the currently signed-in Windows user. It is not a sandbox or security boundary. Only run commands you understand.
- Python, Git and other command-line tools must already be installed on the computer if you want to use them in the terminal.
- The portable app does not bundle a full Python/Git toolchain.
- Electron portable builds may use temporary/runtime files in the Windows user profile; the application executable itself can be stored on a USB drive.

## USB use
Copy the downloaded portable executable to your USB drive. Keep your NEXUS folders alongside it. On first launch, the app uses the portable executable's directory as its initial workspace. You can choose another folder from File Explorer inside NEXUS.
