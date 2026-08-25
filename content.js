let video;

function findVideo() {
  return document.querySelector('video.bpx-player-video, .bpx-player-video-wrap video, .bilibili-player-video video')
    || [...document.querySelectorAll('video')].find(item => !item.paused)
    || document.querySelector('video');
}

function report(extra = {}) {
  const active = findVideo();
  if (!active) return;
  video = active;
  chrome.runtime.sendMessage({
    type: 'mediaState',
    bvid: location.pathname.match(/\/video\/(BV[\w]+)/i)?.[1],
    videoTitle: document.querySelector('h1.video-title,.video-title')?.textContent?.trim() || document.title.replace(/_哔哩哔哩_bilibili$/, ''),
    cover: document.querySelector('meta[property="og:image"]')?.content,
    paused: active.paused,
    currentTime: active.currentTime,
    duration: active.duration || 0,
    volume: active.muted ? 0 : active.volume,
    blocked: false,
    ...extra
  });
}

async function tryPlay(fromStart = false) {
  if (fromStart) {
    const startingVideo = video;
    const reset = () => { if (video === startingVideo && startingVideo.readyState >= 1) startingVideo.currentTime = 0; };
    if (startingVideo.readyState >= 1) reset();
    else startingVideo.addEventListener('loadedmetadata', reset, { once: true });
    startingVideo.addEventListener('playing', reset, { once: true });
  }
  try { await video.play(); report(); }
  catch { report({ blocked: true }); }
}

async function attach() {
  const found = findVideo();
  if (!found || found === video) return;
  video = found;
  const result = await chrome.runtime.sendMessage({ type: 'isPlayerTab' }).catch(() => null);
  if (!result?.managed) return;
  video.addEventListener('ended', () => chrome.runtime.sendMessage({ type: 'ended' }));
  video.addEventListener('play', report);
  video.addEventListener('pause', report);
  video.addEventListener('timeupdate', report);
  video.addEventListener('volumechange', report);
  tryPlay(true);
}

chrome.runtime.onMessage.addListener(message => {
  const active = findVideo();
  if (!active) return;
  video = active;
  if (message.type === 'toggle') video.paused ? tryPlay() : video.pause();
  if (message.type === 'seek') video.currentTime = video.duration * message.ratio;
  if (message.type === 'volume') {
    const value = Math.max(0, Math.min(1, message.value));
    video.volume = value;
    video.muted = value === 0;
    report();
  }
});

attach();
new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: true });
