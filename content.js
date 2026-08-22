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

async function tryPlay() {
  try { await video.play(); report(); }
  catch { report({ blocked: true }); }
}

function attach() {
  const found = findVideo();
  if (!found || found === video) return;
  video = found;
  video.addEventListener('ended', () => chrome.runtime.sendMessage({ type: 'ended' }));
  video.addEventListener('play', report);
  video.addEventListener('pause', report);
  video.addEventListener('timeupdate', report);
  video.addEventListener('volumechange', report);
  tryPlay();
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
