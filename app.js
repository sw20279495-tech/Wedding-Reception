'use strict';
const CLIENT_ID = 'e709c8512cd843dba2a399d3d4fea01b';
const SECTIONS = ['Light & Playful', 'Romantic & Intimate', 'Playful Again'];
const redirect = new URL(location.pathname, location.origin).href;
const $ = id => document.getElementById(id);
let tracks = [], original = [], busy = false, loaded = null, currentUser = null;
const receiptKey = 'wedding-reception-receipt';
const store = sessionStorage;
function status(message) { $('status').textContent = message; }
function token() { return JSON.parse(store.getItem('spotify-token') || 'null'); }
function saveToken(data) { store.setItem('spotify-token', JSON.stringify({...data, expires: Date.now() + data.expires_in * 1000})); }
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function connect() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  store.setItem('spotify-verifier', verifier); store.setItem('spotify-state', state);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirect,
    scope: 'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public',
    state, code_challenge_method: 'S256', code_challenge: challenge});
  location.assign(url);
}
async function requestToken(params) {
  const response = await fetch('https://accounts.spotify.com/api/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({...params, client_id:CLIENT_ID})});
  if (!response.ok) throw new Error('Spotify authorization failed. Reconnect and check the redirect URL and app access in Spotify settings.');
  return response.json();
}
async function accessToken() {
  let current = token();
  if (!current) throw new Error('Connect Spotify first.');
  if (Date.now() > current.expires - 60000) {
    if (!current.refresh_token) throw new Error('Authorization expired. Reconnect Spotify.');
    const fresh = await requestToken({grant_type:'refresh_token', refresh_token:current.refresh_token});
    saveToken({...fresh, refresh_token:fresh.refresh_token || current.refresh_token}); current = token();
  }
  return current.access_token;
}
async function api(path, method='GET', body) {
  const response = await fetch('https://api.spotify.com/v1' + path, {method, headers:{Authorization:'Bearer ' + await accessToken(), ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Spotify ${response.status}: ${data.error?.message || 'Request failed'}. ${response.status === 403 ? 'Reconnect Spotify to grant playlist permissions; also check developer app eligibility and permitted Spotify users.' : response.status === 429 ? 'Rate limit reached; wait before retrying.' : ''}`);
  }
  return response.status === 204 ? null : response.json();
}
async function items(id) {
  const output = []; let next = `/playlists/${encodeURIComponent(id)}/items?limit=50`;
  while (next) {
    const page = await api(next); output.push(...page.items);
    if (page.next) {
      const url = new URL(page.next);
      if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/')) throw new Error('Unexpected pagination destination.');
      next = url.pathname.slice(3) + url.search;
    } else next = null;
  }
  return output;
}
function playlistId(input) {
  const match = input.trim().match(/^(?:https:\/\/open\.spotify\.com\/playlist\/|spotify:playlist:)?([A-Za-z0-9]{22})(?:\?.*)?$/);
  if (!match) throw new Error('Enter a valid Spotify playlist link or ID.');
  return match[1];
}
async function load() {
  const id = playlistId($('source').value);
  const metadata = await api(`/playlists/${id}?fields=name,snapshot_id,owner(id)`);
  const rows = await items(id);
  const after = await api(`/playlists/${id}?fields=snapshot_id`);
  if (metadata.snapshot_id !== after.snapshot_id) throw new Error('The source changed during loading. Load it again.');
  const output = rows.map((row, index) => {
    const t = row.item || row.track;
    if (!t || row.is_local || t.is_local || t.type !== 'track' || !t.uri?.startsWith('spotify:track:')) throw new Error(`Song ${index + 1} is unavailable or a local/non-song item. Nothing was created.`);
    return {position:index + 1, title:t.name, artist:t.artists.map(a => a.name).join(', '), uri:t.uri, section:''};
  });
  if (!output.length) throw new Error('Spotify returned no songs.');
  original = output.map(t => ({...t})); tracks = output;
  loaded = {id, name:metadata.name, snapshot:metadata.snapshot_id, owner:metadata.owner?.id};
  render(); status(`Loaded ${output.length} songs from ${metadata.name}. ${output.length !== 73 ? 'This differs from the expected 73 tracks. ' : ''}Assign the three sections before creating.`);
}
function render() {
  $('songs').replaceChildren();
  const ordered = [...SECTIONS, ''];
  for (const section of ordered) {
    const group = tracks.filter(t => t.section === section);
    if (!group.length) continue;
    const heading = document.createElement('h3'); heading.textContent = `${section || 'Choose a section'} (${group.length})`; $('songs').append(heading);
    for (const t of group) {
      const row = document.createElement('div'); row.className = 'song';
      const info = document.createElement('div'); info.className = 'song-info';
      const title = document.createElement('strong'); title.textContent = t.title;
      const artist = document.createElement('small'); artist.textContent = `${t.artist} · Original #${t.position}`; info.append(title, artist);
      const controls = document.createElement('div'); controls.className = 'controls';
      const select = document.createElement('select'); select.setAttribute('aria-label', `Section for ${t.title}`);
      for (const s of ['', ...SECTIONS]) { const option = document.createElement('option'); option.value=s; option.textContent=s || 'Choose section'; select.append(option); }
      select.value=t.section; select.disabled=busy; select.onchange=()=>{ t.section=select.value; render(); };
      controls.append(select);
      for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
        const button=document.createElement('button'); button.textContent=label; button.setAttribute('aria-label', `Move ${t.title} ${delta < 0 ? 'up' : 'down'}`);
        const target=group[group.indexOf(t)+delta]; button.disabled=busy || !target;
        button.onclick=()=>{ const a=tracks.indexOf(t), b=tracks.indexOf(target); [tracks[a], tracks[b]]=[tracks[b], tracks[a]]; render(); }; controls.append(button);
      }
      row.append(info, controls); $('songs').append(row);
    }
  }
  $('count').textContent=tracks.length ? `${tracks.length} songs · ${tracks.filter(t=>!t.section).length} still need a section` : '';
  $('summary').textContent=tracks.length ? SECTIONS.map(s=>`${s}: ${tracks.filter(t=>t.section===s).length}`).join(' · ') : 'Load and arrange the songs first.';
  $('create').disabled=busy || !tracks.length || tracks.some(t=>!t.section) || !!store.getItem(receiptKey);
  $('export').disabled=busy || !original.length;
  $('apply-order').disabled=busy;
  $('update').disabled=busy || !loaded || !tracks.length || tracks.some(t=>!t.section) || loaded.owner !== currentUser;
}
async function create() {
  if (store.getItem(receiptKey)) throw new Error('A playlist was already created in this tab. Check the saved playlist link before making another.');
  const ordered=SECTIONS.flatMap(s=>tracks.filter(t=>t.section===s));
  if (!ordered.length || ordered.length !== tracks.length) throw new Error('Assign every song to a section first.');
  if (!confirm(`Create a NEW PRIVATE Wedding Reception playlist with ${ordered.length} songs? Your original will stay untouched.`)) return;
  const playlist=await api('/me/playlists', 'POST', {name:'Wedding Reception',public:false,description:'Light & Playful → Romantic & Intimate → Playful Again'});
  const receipt={id:playlist.id,url:playlist.external_urls.spotify,verified:false};
  store.setItem(receiptKey,JSON.stringify(receipt)); showReceipt(receipt);
  for (let offset=0;offset<ordered.length;offset+=100) await api(`/playlists/${playlist.id}/items`, 'POST', {uris:ordered.slice(offset,offset+100).map(t=>t.uri)});
  const actual=(await items(playlist.id)).map(row=>(row.item || row.track)?.uri);
  if (JSON.stringify(actual)!==JSON.stringify(ordered.map(t=>t.uri))) throw new Error('Playlist created, but exact order verification failed. Open the saved playlist link and inspect it before retrying.');
  receipt.verified=true; store.setItem(receiptKey,JSON.stringify(receipt)); showReceipt(receipt);
  status(`Created and verified ${ordered.length} songs in order. Your original playlist was not changed.`);
}
function showReceipt(receipt) {
  const a=document.createElement('a'); a.href=`https://open.spotify.com/playlist/${encodeURIComponent(receipt.id)}`; a.target='_blank'; a.rel='noopener'; a.textContent='Open Wedding Reception';
  $('result').replaceChildren(document.createTextNode(receipt.verified ? 'Created and verified: ' : 'Playlist created; it may be incomplete if adding songs failed: '),a);
}
async function run(action) {
  if (busy) return; busy=true; $('load').disabled=true; $('connect').disabled=true; $('disconnect').disabled=true; render();
  try { await action(); } catch(error) { status(error.message); }
  finally { busy=false; $('load').disabled=!token(); $('connect').disabled=false; $('disconnect').disabled=false; render(); }
}
$('redirect').textContent=redirect;
$('connect').onclick=()=>run(connect);
$('disconnect').onclick=()=>{store.removeItem('spotify-token'); store.removeItem('spotify-state'); store.removeItem('spotify-verifier'); location.replace(redirect);};
$('load').onclick=()=>run(load); $('create').onclick=()=>run(create);
$('apply-order').onclick=()=>run(async()=>{
  $('order-status').textContent='Checking your loaded songs against the CSV…';
  try { await applySavedOrder(); $('order-status').textContent='Applied all 73 songs in CSV order. Scroll to step 3 and choose Update loaded playlist order to save to Spotify.'; }
  catch(error) { $('order-status').textContent=error.message; throw error; }
}); $('update').onclick=()=>run(updateCurrent);
$('export').onclick=()=>{
  const blob=new Blob([JSON.stringify(original,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='wedding-original-order.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
run(async()=>{
  const params=new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    const state=store.getItem('spotify-state'), verifier=store.getItem('spotify-verifier');
    history.replaceState({},'',redirect);
    store.removeItem('spotify-state'); store.removeItem('spotify-verifier');
    if (!state || params.get('state')!==state || !verifier) throw new Error('Authorization state did not match. Connect Spotify again in this tab.');
    if (params.has('error')) throw new Error('Spotify authorization was declined.');
    saveToken(await requestToken({grant_type:'authorization_code',code:params.get('code'),redirect_uri:redirect,code_verifier:verifier}));
  }
  const receipt=store.getItem(receiptKey); if (receipt) showReceipt(JSON.parse(receipt));
  if (token()) {
    const me=await api('/me'); currentUser=me.id; $('account').textContent=`Connected as ${me.display_name || me.id}`; $('disconnect').hidden=false;
    status('Connected. Load your playlist to arrange its songs.');
  }
});

async function applySavedOrder() {
  if (!tracks.length) throw new Error('Click Load playlist first, wait for the song count, then apply the CSV order.');
  const response = await fetch('wedding-order.json', {cache:'no-store', signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('Could not load the saved CSV order. Refresh after the latest deployment completes.');
  const rows = await response.json();
  const order = rows.slice().sort((a,b)=>a.order-b.order);
  if (order.length !== 73 || order.some((r,i)=>r.order !== i+1)) throw new Error('The saved order must contain positions 1–73 exactly once.');
  const available = new Map();
  for (const t of tracks) { if (!available.has(t.uri)) available.set(t.uri,[]); available.get(t.uri).push(t); }
  const arranged = [];
  for (const row of order) {
    const section = SECTIONS.find(s=>s.toLowerCase()===row.section.toLowerCase());
    if (!section) throw new Error(`Unknown CSV section for ${row.title}.`);
    const t = available.get(row.uri)?.shift();
    if (!t) throw new Error(`CSV song is missing from the loaded playlist: ${row.title} — ${row.artist}. Nothing was changed.`);
    arranged.push({...t,section});
  }
  if ([...available.values()].some(list=>list.length)) throw new Error('The loaded playlist has extra songs not in the CSV. Nothing was changed.');
  if (arranged.some((t,i)=>i && SECTIONS.indexOf(t.section)<SECTIONS.indexOf(arranged[i-1].section))) throw new Error('CSV sections are not in the expected sequence.');
  tracks=arranged;
  render(); status('Matched all 73 songs and applied the exact CSV order in this preview. Choose Update loaded playlist order to save it to Spotify, or create a new private copy.');
}
function rowUris(rows) { return rows.map(row=>(row.item || row.track)?.uri); }
async function updateCurrent() {
  if (!loaded || loaded.owner !== currentUser) throw new Error('Load a playlist owned by your connected Spotify account.');
  const ordered=SECTIONS.flatMap(s=>tracks.filter(t=>t.section===s));
  if (!ordered.length || ordered.length !== tracks.length) throw new Error('Apply the CSV order or assign every section first.');
  const scope=token()?.scope || '';
  if (!scope.split(' ').includes('playlist-modify-public') || !scope.split(' ').includes('playlist-modify-private')) throw new Error('Click Connect Spotify again to grant permission to reorder both public and private playlists.');
  const target=loaded.id, name=loaded.name;
  // Refuse stale data before the first write. Spotify checks snapshot_id on every move.
  const before=await api(`/playlists/${target}?fields=snapshot_id`);
  const current=rowUris(await items(target));
  const after=await api(`/playlists/${target}?fields=snapshot_id`);
  if (before.snapshot_id!==loaded.snapshot || after.snapshot_id!==before.snapshot_id || JSON.stringify(current)!==JSON.stringify(original.map(t=>t.uri))) throw new Error('Playlist changed since loading. Load it again, then apply the CSV order. No changes were made.');
  const desired=ordered.map(t=>t.uri);
  if (JSON.stringify(current.slice().sort())!==JSON.stringify(desired.slice().sort())) throw new Error('Song lists differ. Refusing to add or remove tracks.');
  if (JSON.stringify(current)===JSON.stringify(desired)) {status('This playlist already matches the requested order. No changes needed.');return;}
  if (!confirm(`Reorder all ${desired.length} songs IN "${name}"? This changes this existing playlist, creates no copy, and keeps every song. Avoid editing the playlist elsewhere until this finishes.`)) return;
  let snapshot=before.snapshot_id, moves=0;
  try {
    for (let i=0;i<desired.length;i++) {
      if (current[i]===desired[i]) continue;
      const from=current.indexOf(desired[i],i+1);
      if (from<0) throw new Error('Song matching failed.');
      status(`Updating ${name}: position ${i+1} of ${desired.length}…`);
      const result=await api(`/playlists/${target}/items`,'PUT',{range_start:from,insert_before:i,range_length:1,snapshot_id:snapshot});
      moves++;
      if (!result?.snapshot_id) throw new Error('Spotify did not return an updated snapshot.');
      snapshot=result.snapshot_id;
      const [uri]=current.splice(from,1); current.splice(i,0,uri);
    }
    const verificationBefore=await api(`/playlists/${target}?fields=snapshot_id`);
    const actual=rowUris(await items(target));
    const verificationAfter=await api(`/playlists/${target}?fields=snapshot_id`);
    if (verificationBefore.snapshot_id!==snapshot || verificationAfter.snapshot_id!==snapshot || JSON.stringify(actual)!==JSON.stringify(desired)) throw new Error('Final order verification differed.');
    loaded.snapshot=snapshot;
    original=ordered.map((t,i)=>({...t,position:i+1})); tracks=original.map(t=>({...t}));
    const a=document.createElement('a');a.href=`https://open.spotify.com/playlist/${target}`;a.target='_blank';a.rel='noopener';a.textContent=`Open ${name}`;
    $('result').replaceChildren(document.createTextNode('Updated and verified: '),a);
    status(`Updated ${name}: all ${desired.length} songs now match the preview order. No songs added or removed.`);
  } catch(error) {
    // Never retry writes automatically: a lost response can leave a partially reordered playlist.
    loaded=null;
    throw new Error(`${error.message} The playlist may be partially reordered (${moves} moves acknowledged). Load it again and apply the CSV order before retrying. No songs were deliberately added or removed.`);
  }
}
