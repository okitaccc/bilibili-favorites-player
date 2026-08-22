let state = { videos: [], index: -1, mode: 'loop', tabId: null, paused: true, currentTime: 0, duration: 0, blocked: false, currentVideo: null };
const ready = chrome.storage.session.get('playerState').then(saved => { if (saved.playerState) state = saved.playerState; });
const save = () => chrome.storage.session.set({ playerState: state });

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
  Object.assign(state, { paused: false, currentTime: 0, duration: 0, blocked: false, currentVideo: null });
  const url = `https://www.bilibili.com/video/${state.videos[state.index].bvid}/?autoplay=1`;
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
    blocked: message.blocked
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    await ready;
    if (message.type === 'getState') return respond(state);
    if (message.type === 'start') {
      state = { ...state, videos: message.videos, mode: message.mode, index: -1 };
      await play(1, message.index);
    } else if (message.type === 'next' || message.type === 'ended') await play(1);
    else if (message.type === 'prev') await play(-1);
    else if (message.type === 'mode') { state.mode = message.mode; await save(); }
    else if (message.type === 'toggle') {
      if (state.tabId) chrome.tabs.sendMessage(state.tabId, message).catch(() => {});
      else await play(0, state.index);
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
