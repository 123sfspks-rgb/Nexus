# NEXUS

NEXUS is a Windows application for an encrypted USB vault. Imported files are encrypted on the USB and can only be listed or previewed through NEXUS after the correct password is entered.

## What is protected

- Each imported file is encrypted with AES-256-GCM.
- File names, folder names, and the folder structure are stored in an encrypted manifest.
- The password is never saved. NEXUS derives the encryption key using scrypt.
- The vault is not mounted as a Windows drive. NEXUS does not expose a decrypted folder to File Explorer.
- Supported previews (text, common images, PDF, audio, and video) are decrypted in memory and displayed inside NEXUS. NEXUS does not launch another application or write a plaintext preview file to disk.
- Locking NEXUS, removing the USB, or suspending the PC clears the active key from the app session and closes the preview. Memory clearing is best-effort; no software can promise forensic erasure of RAM.

## Make the USB NEXUS-only

1. Back up anything currently on the USB. Creating a vault does not encrypt files already sitting outside it.
2. For the cleanest setup, use an empty or newly formatted USB drive. Put `NEXUS.exe` at the drive root.
3. Start NEXUS and choose **Create encrypted vault**. Select the USB drive root and set a strong password.
4. Import your files from the PC or another backup location into NEXUS.
5. Keep personal files inside the vault. Do not leave ordinary copies elsewhere on the USB. The only intended item outside the vault is `NEXUS.exe` (plus any auto-run configuration you create yourself).
6. Test by locking NEXUS and checking the USB in File Explorer. The vault data is encrypted; file names and contents will not be readable there.

**Important:** Import copies files into the vault; it does not delete the original copies. If you import from the USB itself, those original files remain readable outside NEXUS. Do not delete your only originals until you have checked the encrypted copies and made a separate backup. Flash-drive formatting and deletion cannot guarantee that old data is physically unrecoverable, so do not reuse a USB containing sensitive old data as though it were securely wiped.

## Using NEXUS

Connect the USB, launch `NEXUS.exe` (or use the auto-run arrangement you configure on your PC), and enter the vault password. Double-click folders to navigate and supported files to preview them inside NEXUS. Right-click files or folders to rename or delete them.

Unsupported formats and files larger than 32 MB remain encrypted but cannot currently be previewed in the built-in viewer. NEXUS does not automatically export or open them in external applications.

## Password and recovery

There is no password reset or recovery key. Losing the password means losing access to the vault. Keep a separate secure backup of important data and the password.

## Auto-run

USB auto-run is not configured by NEXUS. Set up the launch behaviour separately on the Windows PCs you control.
