#!/usr/bin/env python3
"""Export a Spotify playlist for ordering, then create a separate private playlist."""
import argparse
import csv
import json
import os
from pathlib import Path

CLIENT_ID = 'e709c8512cd843dba2a399d3d4fea01b'
SOURCE_ID = '4qq9AdtemsKVUeeSmhI8af'
FIELDS = ['section', 'order', 'title', 'artist', 'uri', 'original_position']
SECTIONS = ('Light & Playful', 'Romantic & Intimate', 'Playful Again')


def validate(rows):
    if not rows:
        raise ValueError('The song list is empty.')
    seen = set()
    for row in rows:
        if row['section'] not in SECTIONS:
            raise ValueError(f"Choose one of {SECTIONS} for {row['title']!r}.")
        try:
            position = int(row['order'])
        except ValueError:
            raise ValueError(f"Order must be a positive whole number for {row['title']!r}.") from None
        if position < 1:
            raise ValueError('Order must be positive.')
        key = (row['section'], position)
        if key in seen:
            raise ValueError(f'Duplicate order within section: {key}')
        seen.add(key)
        if not row['uri'].startswith('spotify:track:'):
            raise ValueError(f"Unsupported track URI: {row['title']!r}")
    return sorted(rows, key=lambda r: (SECTIONS.index(r['section']), int(r['order'])))


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != FIELDS:
            raise ValueError('CSV column names changed; keep the original header.')
        return list(reader)


def export_tracks(sp, folder):
    output = folder / 'songs.csv'
    backup = folder / 'original_order.json'
    if output.exists() or backup.exists():
        raise ValueError('Export files already exist. Use another --folder to preserve them.')
    metadata = sp.playlist(SOURCE_ID, fields='name,snapshot_id')
    page = sp.playlist_items(SOURCE_ID, additional_types=('track',))
    rows = []
    unavailable = []
    original_position = 0
    while page:
        for item in page['items']:
            original_position += 1
            track = item.get('track') or item.get('item')
            if not track or track.get('is_local') or track.get('type') != 'track' or not track.get('uri'):
                unavailable.append(original_position)
                continue
            rows.append(dict(section='', order=str(original_position), title=track['name'],
                             artist=', '.join(a['name'] for a in track['artists']),
                             uri=track['uri'], original_position=str(original_position)))
        page = sp.next(page) if page.get('next') else None
    after = sp.playlist(SOURCE_ID, fields='snapshot_id')
    if after['snapshot_id'] != metadata['snapshot_id']:
        raise ValueError('Source playlist changed during export. Try again.')
    if unavailable:
        raise ValueError(f'Unavailable/local/non-song items at positions {unavailable}; export stopped to avoid silently omitting them.')
    if not rows:
        raise ValueError('Spotify returned no tracks.')
    folder.mkdir(parents=True, exist_ok=True)
    with backup.open('x', encoding='utf-8') as f:
        json.dump({'source_id': SOURCE_ID, 'name': metadata['name'], 'snapshot_id': metadata['snapshot_id'], 'tracks': rows}, f, ensure_ascii=False, indent=2)
    with output.open('x', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f'Exported {len(rows)} tracks to {output}. Expected from your message: 73; actual count is reported here.')
    print('Assign each section and order in songs.csv. Original order is saved separately in original_order.json.')


def create(sp, folder):
    from collections import Counter
    rows = validate(read_csv(folder / 'songs.csv'))
    with (folder / 'original_order.json').open(encoding='utf-8') as f:
        original = json.load(f)
    if Counter((r['uri'], r['original_position']) for r in rows) != Counter((r['uri'], r['original_position']) for r in original['tracks']):
        raise ValueError('Song list differs from the export. Keep all original songs and their URI/position fields.')
    receipt = folder / 'created_playlist.json'
    if receipt.exists():
        raise ValueError('A creation receipt already exists. Inspect it in Spotify before creating another playlist.')
    print(f'Will create PRIVATE playlist Wedding Reception with {len(rows)} tracks:')
    for section in SECTIONS:
        print(f"  {section}: {sum(r['section'] == section for r in rows)}")
    if input('Type CREATE to create the new playlist: ').strip() != 'CREATE':
        print('Cancelled.')
        return
    me = sp.current_user()
    playlist = sp.user_playlist_create(me['id'], 'Wedding Reception', public=False,
        description='Light & Playful → Romantic & Intimate → Playful Again')
    # Persist the new ID before adding tracks so a failure cannot hide a partially created playlist.
    result = {'id': playlist['id'], 'url': playlist['external_urls']['spotify'], 'status': 'created; adding songs'}
    def save():
        receipt.write_text(json.dumps(result, indent=2), encoding='utf-8')
    save()
    uris = [r['uri'] for r in rows]
    for offset in range(0, len(uris), 100):
        sp.playlist_add_items(playlist['id'], uris[offset:offset + 100])
    actual = []
    page = sp.playlist_items(playlist['id'], additional_types=('track',))
    while page:
        for item in page['items']:
            track = item.get('track') or item.get('item') or {}
            actual.append(track.get('uri'))
        page = sp.next(page) if page.get('next') else None
    if actual != uris:
        raise ValueError(f'Playlist created but verification differs. Inspect {receipt}; do not blindly rerun.')
    result['status'] = 'verified'
    result['track_count'] = len(uris)
    save()
    print('Created and verified:', result['url'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['export', 'check', 'create'])
    parser.add_argument('--folder', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    if args.command == 'check':
        rows = validate(read_csv(args.folder / 'songs.csv'))
        print(f'Valid ordering for {len(rows)} tracks. No Spotify changes made.')
        return
    import spotipy
    from spotipy.oauth2 import SpotifyPKCE
    client_id = os.environ.get('SPOTIPY_CLIENT_ID') or CLIENT_ID
    if not client_id:
        raise ValueError('A Spotify app Client ID is required.')
    args.folder.mkdir(parents=True, exist_ok=True)
    scope = 'playlist-read-private playlist-read-collaborative'
    if args.command == 'create':
        scope += ' playlist-modify-private'
    auth = SpotifyPKCE(client_id=client_id, redirect_uri='http://127.0.0.1:8888/callback',
                       scope=scope, cache_path=str(args.folder / '.spotify-token-cache'))
    sp = spotipy.Spotify(auth_manager=auth)
    if args.command == 'export':
        export_tracks(sp, args.folder)
    else:
        create(sp, args.folder)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nCancelled.')
        raise SystemExit(130)
    except Exception as exc:
        # Do not log API request headers, OAuth tokens, or credential values.
        print(f'Operation stopped ({type(exc).__name__}).')
        if isinstance(exc, (ValueError, FileNotFoundError, ModuleNotFoundError)):
            print(str(exc))
        else:
            print('Check Spotify app access, authorized account, and Internet connection. If creation started, inspect created_playlist.json before retrying.')
        raise SystemExit(1)
