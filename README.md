# NEXUS

NEXUS is a Windows desktop app for a password-protected, encrypted USB vault.

## Security model

- Files imported into the vault are encrypted individually with AES-256-GCM.
- The vault index (file names, folder names, and structure) is encrypted too.
- A password-derived key is created with scrypt. The password is never stored.
- The vault folder is marked hidden/system on Windows as a convenience. Hidden is not security; encryption is the protection.
- Wrong passwords do not reveal the file list or file contents.
- Removing the USB or suspending the PC locks the session.
- Files opened in another application are decrypted into a temporary session directory and removed when NEXUS locks or exits. This is best-effort cleanup, not a guarantee of secure erasure.
- Exported files are ordinary plaintext copies. Files in the original source folders also remain plaintext until the user removes those originals.

## First use

1. Put NEXUS.exe on the USB drive.
2. Launch it and choose Create encrypted vault.
3. Select the USB drive or the NEXUS folder on it and set a password of at least 10 characters.
4. Import existing folders and files into the vault.
5. Confirm that the encrypted copies are present before deleting old unencrypted source folders.
6. Keep the password safe. There is no password reset or recovery key.

The encrypted vault is stored in a folder named NEXUS_VAULT on the selected drive. The folder is hidden on Windows, but its contents remain encrypted even if someone reveals it.

## Auto-run

Configure USB auto-run separately on the Windows PCs you control. NEXUS itself does not install a startup helper.

## Important limits

- Losing the password means losing access to the encrypted data.
- Encryption at rest protects the vault while locked. When unlocked, file names and data are available to NEXUS.
- Opening a file in another app creates a temporary decrypted copy. Do not use this for highly sensitive files on a shared or untrusted PC.
- Secure deletion cannot be guaranteed on SSDs, flash drives, or wear-levelled storage. Delete old originals only after checking the encrypted import.
- NEXUS does not automatically encrypt files elsewhere on the USB. Import them into the vault.
