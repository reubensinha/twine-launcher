# Password Reset

Twine Launcher has no email infrastructure, so password resets are admin-driven. There are three flows depending on who needs the reset.

---

## Player forgot their password

Players cannot reset their own password. On the login page, clicking **"Forgot your password?"** shows a message directing them to their admin.

The admin then resets the password on their behalf — see the next section.

---

## Admin resets a user's password

1. Go to **Users** in the navigation bar (admin only).
2. Find the user and click **Reset pw**.
3. A modal appears with a 16-character temporary password and a **Copy** button.
4. Share the temporary password with the user (e.g. paste it into a message).

On the user's next login they are taken directly to a **Set a new password** screen and cannot access the library until they choose a new password. The temporary password is invalidated as soon as they submit the new one.

---

## Admin forgot their own password (recovery file)

If the admin account is locked out and there is no other admin to perform a reset, use the recovery file mechanism.

**Docker:**

1. Place a file named `recovery.txt` inside the Docker volume mapped to `/data` (default: the `data/` directory next to your `docker-compose.yml`).
   - The file contents become the new password if they are 8+ characters long.
   - Leave the file empty (or with fewer than 8 characters) to have a random 16-character password generated instead.
2. Restart the container:
   ```bash
   docker compose restart
   ```
3. Check the container logs for the new temporary password:
   ```bash
   docker compose logs | grep "Recovery file"
   # Recovery file found — admin 'admin' password reset to: aB3xK9mLqR2vNpYw
   ```
4. Log in with the temporary password. You are immediately prompted to set a new password.
5. Confirm that `recovery.txt` has been deleted — the server removes it automatically on startup.

**Windows desktop app:**

1. Locate the data directory: `%AppData%\com.twinelauncher.desktop\` (open File Explorer and paste this path into the address bar).
2. Create `recovery.txt` in that directory, with your desired password as the contents (or leave it empty for a generated one).
3. Restart the app fully: right-click the system tray icon → **Quit**, then relaunch from the Start Menu.
4. Find the temporary password in the server log:
   - **Log file:** open `%AppData%\com.twinelauncher.desktop\data\backend.log` in any text editor and search for `Recovery file`.
5. Log in and set a new password when prompted.
6. Confirm `recovery.txt` has been removed.

> **Security note:** Anyone with filesystem access to the data directory can trigger a password reset. On Docker, restrict volume access accordingly. On Windows, standard user-account isolation normally applies.
