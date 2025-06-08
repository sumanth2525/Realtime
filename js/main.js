const socket   = io();
const form     = document.getElementById('form');
const input    = document.getElementById('input');
const messages = document.getElementById('messages');
const btnJoin  = document.getElementById('join-audio');
const btnLeave = document.getElementById('leave-audio');

let localStream, audioCtx, analyser, dataArray;
const peers = {}; // RTCPeerConnection by socketId

// —————————————————————————————————————————————
// 1) TEXT CHAT
// —————————————————————————————————————————————
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!input.value) return;
  socket.emit('chat message', input.value);
  input.value = '';
});

socket.on('chat message', ({ id, msg }) => {
  const wrapper = document.createElement('div');
  wrapper.classList.add('message');

  // avatar
  const avatar = document.createElement('div');
  avatar.classList.add('avatar');
  avatar.id = 'avatar-' + id;
  wrapper.appendChild(avatar);

  // text
  const text = document.createElement('div');
  text.classList.add('text');
  text.textContent = msg;
  wrapper.appendChild(text);

  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
});

// —————————————————————————————————————————————
// 2) AUDIO MONITOR & BUTTONS
// —————————————————————————————————————————————
btnJoin.onclick = async () => {
  btnJoin.disabled  = true;
  btnLeave.disabled = false;
  await startAudio();
};

btnLeave.onclick = () => {
  btnLeave.disabled  = true;
  btnJoin.disabled   = false;
  stopAudio();

  // tear down all peer connections
  Object.values(peers).forEach(pc => pc.close());
  for (let id in peers) delete peers[id];
};

async function startAudio() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx   = new AudioContext();
  analyser   = audioCtx.createAnalyser();
  const src   = audioCtx.createMediaStreamSource(localStream);
  src.connect(analyser);
  analyser.fftSize = 256;
  dataArray       = new Uint8Array(analyser.frequencyBinCount);

  socket.emit('webrtc-join');
  monitorAudio();
}

function stopAudio() {
  localStream.getTracks().forEach(t => t.stop());
  audioCtx.close();
  analyser = null;
}

function monitorAudio() {
  analyser.getByteFrequencyData(dataArray);
  const volume = dataArray.reduce((a,b) => a + b, 0) / dataArray.length;
  const localAv = document.getElementById('avatar-' + socket.id);
  if (localAv) {
    localAv.classList.toggle('speaking', volume > 20);
  }
  requestAnimationFrame(monitorAudio);
}

// —————————————————————————————————————————————
// 3) WEBRTC SIGNALING & P2P AUDIO
// —————————————————————————————————————————————
socket.on('webrtc-join', () => {
  // ignore—client just emitted this
});

socket.on('webrtc-new-user', async ({ socketId }) => {
  if (!localStream) return;
  const pc    = createPeerConnection(socketId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { to: socketId, offer });
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  const pc = createPeerConnection(from);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: from, answer });
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  const pc = peers[from];
  await pc.setRemoteDescription(answer);
});

socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
  const pc = peers[from];
  if (pc && candidate) pc.addIceCandidate(candidate);
});

function createPeerConnection(remoteId) {
  if (peers[remoteId]) return peers[remoteId];

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[remoteId] = pc;

  // send our audio tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // when we get their audio
  pc.ontrack = e => {
    let audio = document.getElementById('audio-' + remoteId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'audio-' + remoteId;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
  };

  // ICE candidates
  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('webrtc-ice-candidate', {
        to: remoteId,
        candidate: e.candidate
      });
    }
  };

  return pc;
}
