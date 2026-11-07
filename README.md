# NEXUS

NEXUS is a Windows application for an encrypted USB vault with automatic one-way PC-folder sync.

## Encryption and access

- Files copied into the vault are encrypted with AES-256-GCM.
- File names, folder names, folder structure, and configured sync-folder paths are stored in an encrypted manifest.
- The password is never saved. NEXUS derives the encryption key using scrypt.
- The vault is not mounted as a Windows drive. NEXUS does not expose a decrypted folder to File Explorer.
- Supported previews (text, common images, PDF, audio, and video) are decrypted in memory and displayed inside NEXUS. NEXUS does not launch another application or write a plaintext preview file to disk.
- Locking NEXUS, removing the USB, or suspending the PC stops sync and clears the active key from the app session. Memory clearing is best-effort, not a forensic-erasure guarantee.

## Set up the USB

1. Back up anything currently on the USB. An empty or newly formatted USB is recommended.
2. Put `NEXUS.exe` at the USB drive root so your own auto-run setup can launch it.
3. Start NEXUS, choose **Create encrypted vault**, select the USB root, and set a strong password.
4. Use **SYNC PC FOLDERS** to select one or more folders on your PC. You only need to select each source folder once.
5. NEXUS immediately syncs the selected folders, including their subfolders. It then watches for changes and performs a fallback scan every 15 seconds while the USB is connected and the vault is unlocked.
6. Keep personal files inside the encrypted vault. Do not leave ordinary copies beside `NEXUS.exe` on the USB.

The vault folder is marked hidden/system in Windows, but hiding is only cosmetic. The contents remain encrypted even if someone reveals the folder.

## Automatic sync behaviour

- New PC files: copied into the vault and encrypted.
- Changed PC files: the encrypted copy is replaced with a newly encrypted version.
- Subfolders: included recursively.
- PC originals: never changed or deleted.
- Deleted or renamed PC files: the previously synced encrypted copy is retained. A renamed file may appear as a new entry; NEXUS does not silently delete your vault data.
- USB disconnected or NEXUS locked: syncing pauses. It resumes after reconnecting and unlocking the same vault.
- Sync is one-way: PC to encrypted USB. Editing files inside NEXUS does not write changes back to the PC source folders.

The sync list is stored inside the encrypted manifest. If the PC source folder is renamed or moved, NEXUS cannot find it automatically; add its new location as another source. Syncing a large folder the first time may take a while.

## Supported previews

NEXUS currently previews text formats, common images, PDF, audio, and video files up to 32 MB. Other files are still encrypted and stored, but cannot yet be previewed inside NEXUS. NEXUS does not open them in external applications or export plaintext copies.

## Important safety and recovery notes

- Import and sync create encrypted copies. They do not remove the original PC files.
- Do not delete your only source copies until you have checked the vault and made a separate backup.
- There is no password reset or recovery key. Losing the password means losing access to the vault.
- USB auto-run is configured separately by you; NEXUS does not install or change your auto-run configuration.
- This is application-level encrypted storage, not a Windows device driver. The USB drive itself remains visible to Windows, and any ordinary files outside `NEXUS_VAULT` remain readable.
