# Wedding Reception — Spotify browser app

Use this app through GitHub Pages without installing Python or running a server on your computer. Your public Spotify Client ID is configured. Authorization uses PKCE; no Client Secret belongs in this repository.

## Publish from this repository

1. Push these files to `main` in `sw20279495-tech/Wedding-Reception`.
2. In GitHub repository Settings → Pages, select **GitHub Actions** as the source. The included Deploy Wedding Reception workflow deploys only index.html, app.js, and style.css. Run it from Actions if enabling Pages after the push.
3. The expected site address is `https://sw20279495-tech.github.io/Wedding-Reception/`. Confirm the actual address in Pages settings.
4. Add that exact address (including trailing slash) to your Spotify developer app's Redirect URIs. The app displays the redirect URL it uses. If you use a custom domain or open index.html explicitly, register that exact displayed URL instead.
5. Open the site, connect Spotify, load the Wedding playlist, and assign each song to Light & Playful, Romantic & Intimate, or Playful Again. Move songs within each section with the arrow buttons. Download original order before leaving the tab if desired.
6. For the uploaded Wedding_Reordered.csv, click **Apply Wedding_Reordered.csv order**. The saved order contains 73 Spotify track URIs: 24 Light & Playful, 29 Romantic & Intimate, and 20 Playful Again. All songs must match the loaded playlist exactly, including duplicate counts; missing/extra songs stop the operation. This step only changes the preview.
7. To modify the existing playlist, download its original order, then click **Update loaded playlist order** and confirm its name. Only playlists owned by your connected account can be updated. Reconnect Spotify after this update to grant both public and private playlist modification scopes. The app checks the loaded snapshot, moves existing songs with snapshot checks, and verifies the final order. It does not add or remove songs. Avoid editing from another device while updating. An interruption can leave a partial order: load again, reapply the CSV, then retry. No automatic write retries occur.
8. Alternatively, **Create private Wedding Reception playlist** creates a new private copy and leaves the loaded playlist unchanged.

Spotify app eligibility and permitted-user restrictions still apply. A public website does not give everyone Spotify API access. If Spotify denies access, check the developer dashboard's current restrictions and account permissions.

## State and recovery

Tokens and the creation receipt are stored in sessionStorage for the current tab, not in GitHub. Disconnect clears authorization. Refreshing retains the creation receipt but loses unsaved song arrangement. Closing the tab clears its session. Download the original order to keep a separate copy. The receipt link is saved immediately on playlist creation; if adding songs fails, inspect that playlist before trying again. A saved receipt prevents another creation in the same tab. Do not blindly reconnect in a new tab and create duplicates.

Track count is read from Spotify. The saved CSV contains 73 songs; applying it requires an exact match with the loaded song list. Local, unavailable, or non-song items stop loading rather than being silently skipped. The saved CSV supplies the three sections and exact order; manual section assignment is also available.

## Validation

JavaScript syntax and browser flow are checked locally with mocked Spotify responses: connection state, loading, section assignment, private creation, ordering, final verification, creation receipt persistence, and the full 73-song CSV flow (successful in-place reorder, missing song, stale snapshot, and interrupted write). Live Spotify authorization, account eligibility, GitHub Pages publication, and real playlist creation require validation after deployment.

## Optional local Python organizer

# Wedding Reception organizer

Configured with your public Spotify Client ID. No Client Secret is used.

Creates a separate private playlist from Spotify playlist 4qq9AdtemsKVUeeSmhI8af. It never edits the source. No playlist has been created yet. The expected 73-song count and musical grouping have not been verified.

## Set up on your computer

1. In https://developer.spotify.com/dashboard create a Spotify app, subject to Spotify's current developer-account eligibility and access rules. Register exactly `http://127.0.0.1:8888/callback` as a redirect URI. The supplied Client ID is already configured; this organizer uses PKCE and does not need a Client Secret. Your Spotify account must be permitted to use the app.
2. Open a terminal in this folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python create_playlist.py export
```

On Windows, use `py -m venv .venv` and `.venv\Scripts\activate` instead of the first two commands.

3. Your Client ID is already configured. Authorize in your browser. Keep this local computer running during the redirect. If Spotify denies access, check dashboard access eligibility; the organizer cannot bypass Spotify restrictions.
4. Open `songs.csv` in a spreadsheet. Keep every row and the column headers. Set `section` to exactly one of:
   - `Light & Playful`
   - `Romantic & Intimate`
   - `Playful Again`

   Set `order` to a positive whole number within that section. Orders must be unique within each section. The organizer plays sections in the sequence above. Keep title, artist, uri, and original_position unchanged. Save as UTF-8 CSV. The export preserves the original order separately in `original_order.json`, including duplicate tracks.
5. Validate, then create:

```sh
python create_playlist.py check
python create_playlist.py create
```

Review the section counts and type CREATE. Authorize the additional private-playlist creation permission if asked. The organizer saves `created_playlist.json` as soon as Spotify creates the playlist, then adds songs and verifies their exact URI order. Keep that receipt. If creation fails partway through, inspect the new playlist using its receipt before retrying; the script deliberately blocks duplicate creation while a receipt exists.

No automatic musical categorization is claimed. Exported track count may differ from 73 if the source has changed. Unavailable tracks, local files, and non-song items stop export rather than being silently removed.

`.spotify-token-cache` stores your local authorization token. Keep it private; do not upload it or share your working folder after authorization. To share the song list for ordering help, share only title/artist rows, or songs.csv. You can revoke app access in Spotify account settings.

Validation here covers script syntax and ordering/error handling. End-to-end Spotify authorization and creation must be completed on your computer and have not been tested against your account.
