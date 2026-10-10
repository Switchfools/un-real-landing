export function setupAudio(root = document) {
  root.querySelectorAll('[data-audio-player]').forEach(player => {
    if (player.dataset.ready) return;
    player.dataset.ready = 'true';
    const audio = player.querySelector('audio');
    const speed = player.querySelector('[data-audio-speed]');
    const tracks = player.querySelector('[data-audio-track]');
    const download = player.querySelector('[data-audio-download]');
    speed.addEventListener('change', () => { audio.playbackRate = Number(speed.value); });
    const changeTrack = async () => {
      audio.src = tracks.value;
      download.href = tracks.value;
      audio.playbackRate = Number(speed.value);
      try { await audio.play(); } catch { /* Native play controls remain available. */ }
    };
    tracks?.addEventListener('change', changeTrack);
    audio.addEventListener('ended', () => {
      if (tracks && tracks.selectedIndex < tracks.options.length - 1) { tracks.selectedIndex++; changeTrack(); }
    });
    audio.addEventListener('error', () => {
      let message = player.querySelector('[role="status"]');
      if (!message) { message = document.createElement('p'); message.setAttribute('role', 'status'); player.append(message); }
      message.textContent = 'The recording could not be played. Try downloading the audio.';
    });
  });
}
setupAudio();

export function setupSharing(root = document) {
  root.querySelectorAll('[data-essay-share]').forEach(section => {
    if (section.dataset.ready) return;
    section.dataset.ready = 'true';
    const status = section.querySelector('[data-share-status]');
    const copy = section.querySelector('[data-copy-link]');
    if (navigator.clipboard?.writeText) {
      copy.hidden = false;
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(section.dataset.url); status.textContent = 'Link copied. Share it with someone who will put the idea to work.'; }
        catch { status.textContent = 'Copy the address from Permanent link to share this essay.'; }
      });
    }
    const share = section.querySelector('[data-native-share]');
    if (navigator.share) {
      share.hidden = false;
      share.addEventListener('click', async () => {
        try { await navigator.share({ title: section.dataset.title, url: section.dataset.url }); }
        catch (error) { if (error.name !== 'AbortError') status.textContent = 'Use Copy link or Permanent link to share this essay.'; }
      });
    }
  });
}
setupSharing();
