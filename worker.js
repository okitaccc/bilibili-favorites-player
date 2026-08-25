let state = { videos: [], index: -1, mode: 'loop', tabId: null, paused: true, currentTime: 0, duration: 0, volume: 1, blocked: false, currentVideo: null, lyric: '正在读取字幕…' };
const ready = chrome.storage.session.get('playerState').then(saved => { if (saved.playerState) state = saved.playerState; });
const save = () => chrome.storage.session.set({ playerState: state });
const subtitleCache = new Map();
let activeSubtitleKey = '';
let activeSubtitleLines = null;

function pick(step) {
  if (state.mode === 'shuffle' && step > 0 && state.videos.length > 1) {
    let next;
    do next = Math.floor(Math.random() * state.videos.length); while (next === state.index);
    return next;
  }
  return (state.index + step + state.videos.length) % state.videos.length;
}

async function play(step = 1, exactIndex) {
  if (!state.videos.length) return;
  state.index = exactIndex ?? pick(step);
  Object.assign(state, { paused: false, currentTime: 0, duration: 0, blocked: false, currentVideo: null, lyric: '正在读取字幕…' });
  activeSubtitleKey = '';
  activeSubtitleLines = null;
  const url = `https://www.bilibili.com/video/${state.videos[state.index].bvid}/?autoplay=1&t=0`;
  try {
    if (state.tabId) {
      await chrome.tabs.update(state.tabId, { url, active: false });
      await save();
      return;
    }
  } catch { state.tabId = null; }
  const tab = await chrome.tabs.create({ url, active: false });
  state.tabId = tab.id;
  await save();
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadSubtitles(bvid, page) {
  const key = `${bvid}:${page}`;
  if (subtitleCache.has(key)) return subtitleCache.get(key);
  try {
    const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    if (view.code) throw Error(view.message);
    const cid = view.data.pages?.find(item => item.page === page)?.cid || view.data.cid;
    const player = await fetchJson(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`);
    if (player.code) throw Error(player.message);
    const subtitles = player.data.subtitle?.subtitles || [];
    const selected = subtitles.find(item => /(^zh|中文)/i.test(`${item.lan} ${item.lan_doc}`)) || subtitles[0];
    if (!selected) return [];
    const url = selected.subtitle_url.startsWith('//') ? `https:${selected.subtitle_url}` : selected.subtitle_url;
    const data = await fetchJson(url);
    const lines = data.body || [];
    subtitleCache.set(key, lines);
    return lines;
  } catch {
    subtitleCache.set(key, []);
    return [];
  }
}

function updateLyric(time) {
  if (activeSubtitleLines === null) state.lyric = '正在读取字幕…';
  else if (!activeSubtitleLines.length) state.lyric = '当前视频没有可用字幕';
  else state.lyric = activeSubtitleLines.find(line => time >= line.from && time <= line.to)?.content || '♪';
}

function requestSubtitles(bvid, page) {
  const key = `${bvid}:${page}`;
  if (key === activeSubtitleKey) return;
  activeSubtitleKey = key;
  activeSubtitleLines = null;
  updateLyric(state.currentTime);
  loadSubtitles(bvid, page).then(lines => {
    if (key !== activeSubtitleKey) return;
    activeSubtitleLines = lines;
    updateLyric(state.currentTime);
    save();
  });
}

function syncMedia(message) {
  if (message.bvid) {
    const index = state.videos.findIndex(video => video.bvid === message.bvid);
    if (index >= 0) {
      state.index = index;
      state.currentVideo = null;
    } else {
      state.currentVideo = { bvid: message.bvid, title: message.videoTitle || '网页中的视频', cover: message.cover };
    }
  }
  Object.assign(state, {
    paused: message.paused,
    currentTime: message.currentTime,
    duration: message.duration,
    volume: message.volume,
    blocked: message.blocked
  });
  if (message.bvid) requestSubtitles(message.bvid, message.page || 1);
  updateLyric(message.currentTime);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    await ready;
    if (message.type === 'getState') return respond(state);
    if (message.type === 'isPlayerTab') return respond({ managed: sender.tab?.id === state.tabId });
    if (message.type === 'start') {
      state = { ...state, videos: message.videos, mode: message.mode, index: -1 };
      await play(1, message.index);
    } else if (message.type === 'next') await play(1);
    else if (message.type === 'ended' && sender.tab?.id === state.tabId) await play(1);
    else if (message.type === 'prev') await play(-1);
    else if (message.type === 'mode') { state.mode = message.mode; await save(); }
    else if (message.type === 'toggle') {
      if (state.tabId) chrome.tabs.sendMessage(state.tabId, message).catch(() => {});
      else await play(0, state.index);
    } else if (message.type === 'volume') {
      state.volume = message.value;
      await save();
      if (state.tabId) chrome.tabs.sendMessage(state.tabId, message).catch(() => {});
    } else if (message.type === 'seek' && state.tabId) chrome.tabs.sendMessage(state.tabId, message).catch(() => {});
    else if (message.type === 'mediaState' && sender.tab?.id === state.tabId) { syncMedia(message); await save(); }
    respond({ ok: true });
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.tabId) {
    state.tabId = null;
    state.paused = true;
    save();
  }
});
