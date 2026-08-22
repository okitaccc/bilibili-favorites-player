const $ = selector => document.querySelector(selector);
const status = text => $('#status').textContent = text;
const CACHE_TTL = 15 * 60 * 1000;
let videos = [];
let player = { index: -1, mode: 'loop', paused: true, currentTime: 0, duration: 0 };

async function loadTheme() {
  const { theme = 'light' } = await chrome.storage.local.get('theme');
  document.documentElement.dataset.theme = theme;
}

async function api(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.bilibili.com${path}`, { credentials: 'include' });
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json.code) throw Error(json.message || `B站接口错误 ${json.code}`);
      return json.data;
    } catch (error) {
      if (text.trimStart().startsWith('{')) throw error;
      if (attempt === 2) throw Error('B站暂时拒绝了收藏夹请求');
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
}

function showFolders(folders, selected) {
  $('#folder').replaceChildren(...folders.map(item => new Option(`${item.title}（${item.media_count}）`, item.id)));
  if (selected && folders.some(item => String(item.id) === String(selected))) $('#folder').value = selected;
}

function showTracks() {
  $('#track').replaceChildren(...videos.map((item, index) => new Option(item.title, index)));
  syncTrackSelection();
}

function syncTrackSelection() {
  const current = player.currentVideo || player.videos?.[player.index];
  const index = current ? videos.findIndex(item => item.bvid === current.bvid) : -1;
  $('#track').selectedIndex = index;
}

async function loadFolders(force = false) {
  const saved = await chrome.storage.local.get(['folderId', 'folderCache']);
  const cache = saved.folderCache;
  if (!force && cache && Date.now() - cache.updated < CACHE_TTL) {
    showFolders(cache.items, saved.folderId);
    await loadVideos(false);
    return;
  }
  try {
    const nav = await api('/x/web-interface/nav');
    if (!nav.isLogin) throw Error('请先在浏览器中登录 B 站');
    const data = await api(`/x/v3/fav/folder/created/list-all?up_mid=${nav.mid}`);
    await chrome.storage.local.set({ folderCache: { updated: Date.now(), items: data.list } });
    showFolders(data.list, saved.folderId);
    await loadVideos(force);
  } catch (error) {
    if (!cache) return status(`${error.message}，请稍后再试`);
    showFolders(cache.items, saved.folderId);
    status(`${error.message}，已使用上次缓存`);
    await loadVideos(false, true);
  }
}

async function loadVideos(force = false, allowStale = false) {
  const folderId = $('#folder').value;
  const { playlistCache = {} } = await chrome.storage.local.get('playlistCache');
  const cached = playlistCache[folderId];
  if (!force && cached && (allowStale || Date.now() - cached.updated < CACHE_TTL)) {
    videos = cached.items;
    showTracks();
    status(`收藏夹中有 ${videos.length} 个视频 · 已缓存`);
    return;
  }
  try {
    status('正在刷新收藏夹…');
    const fresh = [];
    for (let pn = 1; ; pn++) {
      const data = await api(`/x/v3/fav/resource/list?media_id=${folderId}&pn=${pn}&ps=40&platform=web`);
      fresh.push(...(data.medias || []).filter(item => item.attr === 0).map(item => ({ bvid: item.bvid, title: item.title, cover: item.cover })));
      if (!data.has_more) break;
      status(`正在刷新收藏夹…已载入 ${fresh.length} 首`);
      await new Promise(resolve => setTimeout(resolve, 450));
    }
    videos = fresh;
    playlistCache[folderId] = { updated: Date.now(), items: videos };
    await chrome.storage.local.set({ playlistCache });
    showTracks();
    status(`收藏夹中有 ${videos.length} 个视频 · 刚刚刷新`);
  } catch (error) {
    if (!cached) return status(`${error.message}，请稍后再试`);
    videos = cached.items;
    showTracks();
    status(`${error.message}，已使用上次缓存`);
  }
}

function time(seconds = 0) {
  seconds = Math.floor(seconds || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function render() {
  const video = player.currentVideo || player.videos?.[player.index];
  if (video) {
    $('#title').textContent = video.title;
    $('#title').title = video.title;
    if (video.cover) $('#cover').src = video.cover;
    $('#position').textContent = player.currentVideo ? '网页正在播放' : `${player.index + 1} / ${player.videos.length}`;
    syncTrackSelection();
  }
  document.body.classList.toggle('playing', !player.paused);
  $('#toggle').dataset.paused = player.paused;
  $('#toggle').title = player.paused ? '播放' : '暂停';
  $('#current').textContent = time(player.currentTime);
  $('#duration').textContent = time(player.duration);
  $('#progress').value = player.duration ? player.currentTime / player.duration * 100 : 0;
  if (document.activeElement !== $('#volume')) $('#volume').value = player.volume ?? 1;
  $('#mode').dataset.mode = player.mode;
  $('#mode').title = player.mode === 'shuffle' ? '随机播放' : '列表循环';
  if (player.blocked) status('浏览器拦截了自动播放：请在播放标签页手动播放一次');
}

async function refreshPlayer() {
  const result = await chrome.runtime.sendMessage({ type: 'getState' });
  if (result) { player = result; render(); }
}

$('#folder').addEventListener('change', async () => {
  await chrome.storage.local.set({ folderId: $('#folder').value });
  loadVideos(false);
});
$('#track').addEventListener('change', async () => {
  const index = Number($('#track').value);
  const current = player.videos?.[player.index];
  if (!videos[index] || videos[index].bvid === current?.bvid) return;
  status(`正在切换到：${videos[index].title}`);
  await chrome.runtime.sendMessage({ type: 'start', videos, index, mode: player.mode });
  setTimeout(refreshPlayer, 300);
});
$('#toggle').addEventListener('click', async () => {
  if (player.index < 0 || !player.videos?.length) {
    if (!videos.length) return;
    await chrome.runtime.sendMessage({ type: 'start', videos, index: Number($('#track').value), mode: player.mode });
  } else await chrome.runtime.sendMessage({ type: 'toggle' });
  setTimeout(refreshPlayer, 300);
});
$('#prev').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'prev' }));
$('#next').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'next' }));
$('#mode').addEventListener('click', async () => {
  player.mode = player.mode === 'loop' ? 'shuffle' : 'loop';
  await chrome.runtime.sendMessage({ type: 'mode', mode: player.mode });
  render();
});
$('#reload').addEventListener('click', () => loadFolders(true));
$('#progress').addEventListener('change', () => chrome.runtime.sendMessage({ type: 'seek', ratio: Number($('#progress').value) / 100 }));
$('#volume').addEventListener('input', () => chrome.runtime.sendMessage({ type: 'volume', value: Number($('#volume').value) }));
$('#theme').addEventListener('click', async () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  await chrome.storage.local.set({ theme });
});
$('#pin').addEventListener('click', () => chrome.windows.create({ url: 'popup.html?window=1', type: 'popup', width: 590, height: 280 }));

if (new URLSearchParams(location.search).has('window')) {
  document.documentElement.classList.add('standalone');
  $('#pin').title = '已锁定为独立窗口';
  $('#pin').disabled = true;
  let timer;
  const lockSize = async () => {
    const current = await chrome.windows.getCurrent();
    const width = 560 + window.outerWidth - window.innerWidth;
    const height = Math.ceil($('.player').scrollHeight) + window.outerHeight - window.innerHeight;
    if (Math.abs(current.width - width) > 1 || Math.abs(current.height - height) > 1) await chrome.windows.update(current.id, { width, height });
  };
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(lockSize, 120); });
  setTimeout(lockSize, 50);
}

loadTheme();
loadFolders(false);
refreshPlayer();
setInterval(refreshPlayer, 1000);
