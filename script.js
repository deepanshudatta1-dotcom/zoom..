const state = {
  peer: null,
  myPeerId: null,
  myUserName: '',
  roomId: '',
  isHost: false,
  localStream: null,
  screenStream: null,
  audioEnabled: true,
  videoEnabled: true,
  isScreenSharing: false,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  recInterval: null,
  recSeconds: 0,
  calls: {},
  dataConns: {},
  participants: {},
  activeSidebarTab: null,
  unreadMessages: 0,
  timerInterval: null,
  secondsElapsed: 0
};

const dom = {
  toast: document.getElementById('toast'),
  recIndicator: document.getElementById('rec-indicator'),
  recTimer: document.getElementById('rec-timer'),
  lobbyScreen: document.getElementById('lobby-screen'),
  lobbyVideo: document.getElementById('lobby-video'),
  lobbyAvatar: document.getElementById('lobby-avatar'),
  lobbyAvatarInitial: document.getElementById('lobby-avatar-initial'),
  lobbyMicBtn: document.getElementById('lobby-mic-btn'),
  lobbyCamBtn: document.getElementById('lobby-cam-btn'),
  joinForm: document.getElementById('join-form'),
  userNameInput: document.getElementById('user-name'),
  roomIdInput: document.getElementById('room-id'),
  generateIdBtn: document.getElementById('generate-id-btn'),
  lobbyError: document.getElementById('lobby-error'),
  joinBtn: document.getElementById('join-btn'),
  meetingScreen: document.getElementById('meeting-screen'),
  videoGrid: document.getElementById('video-grid'),
  reactionsLayer: document.getElementById('reactions-layer'),
  displayRoomId: document.getElementById('display-room-id'),
  copyRoomBtn: document.getElementById('copy-room-btn'),
  meetingTimer: document.getElementById('meeting-timer'),
  btnMic: document.getElementById('btn-mic'),
  btnCam: document.getElementById('btn-cam'),
  btnScreen: document.getElementById('btn-screen'),
  btnRecord: document.getElementById('btn-record'),
  btnReactions: document.getElementById('btn-reactions'),
  reactionPicker: document.getElementById('reaction-picker'),
  btnParticipants: document.getElementById('btn-participants'),
  participantBadge: document.getElementById('participant-badge'),
  btnChat: document.getElementById('btn-chat'),
  chatUnreadDot: document.getElementById('chat-unread-dot'),
  btnLeave: document.getElementById('btn-leave'),
  rightSidebar: document.getElementById('right-sidebar'),
  tabChat: document.getElementById('tab-chat'),
  tabParticipants: document.getElementById('tab-participants'),
  closeSidebarBtn: document.getElementById('close-sidebar-btn'),
  panelChat: document.getElementById('panel-chat'),
  panelParticipants: document.getElementById('panel-participants'),
  chatMessages: document.getElementById('chat-messages'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  participantsList: document.getElementById('participants-list'),
  participantCountHeader: document.getElementById('participant-count-header')
};

/* 1. AUTO-FILL ROOM ID FROM INVITE URL (?room=xxxx) & LOBBY PREVIEW */
function checkInviteUrl() {
  const params = new URLSearchParams(window.location.search);
  const invitedRoom = params.get('room');
  if (invitedRoom) {
    dom.roomIdInput.value = invitedRoom;
  }
}

async function initLobbyPreview() {
  checkInviteUrl();
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    dom.lobbyVideo.srcObject = state.localStream;
  } catch {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.videoEnabled = false;
      updateLobbyPreviewUI();
    } catch {
      state.localStream = new MediaStream();
      state.audioEnabled = false;
      state.videoEnabled = false;
      updateLobbyPreviewUI();
    }
  }
}

function updateLobbyPreviewUI() {
  const nameVal = dom.userNameInput.value.trim();
  dom.lobbyAvatarInitial.textContent = nameVal ? nameVal[0].toUpperCase() : '?';
  dom.lobbyMicBtn.classList.toggle('off', !state.audioEnabled);
  dom.lobbyMicBtn.innerHTML = state.audioEnabled
    ? '<i class="fa-solid fa-microphone"></i>'
    : '<i class="fa-solid fa-microphone-slash"></i>';
  dom.lobbyCamBtn.classList.toggle('off', !state.videoEnabled);
  dom.lobbyCamBtn.innerHTML = state.videoEnabled
    ? '<i class="fa-solid fa-video"></i>'
    : '<i class="fa-solid fa-video-slash"></i>';
  dom.lobbyVideo.classList.toggle('hidden', !state.videoEnabled);
  dom.lobbyAvatar.classList.toggle('hidden', state.videoEnabled);
}

dom.userNameInput.addEventListener('input', updateLobbyPreviewUI);

dom.lobbyMicBtn.addEventListener('click', () => {
  const t = state.localStream?.getAudioTracks()[0];
  if (t) {
    state.audioEnabled = !state.audioEnabled;
    t.enabled = state.audioEnabled;
    updateLobbyPreviewUI();
  }
});

dom.lobbyCamBtn.addEventListener('click', () => {
  const t = state.localStream?.getVideoTracks()[0];
  if (t) {
    state.videoEnabled = !state.videoEnabled;
    t.enabled = state.videoEnabled;
    updateLobbyPreviewUI();
  }
});

dom.generateIdBtn.addEventListener('click', () => {
  dom.roomIdInput.value =
    Math.random().toString(36).substring(2, 6) + '-' +
    Math.random().toString(36).substring(2, 6);
});

dom.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const userName = dom.userNameInput.value.trim();
  const roomId = dom.roomIdInput.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');

  if (!userName || !roomId) {
    dom.lobbyError.textContent = 'Please enter both your name and a valid Room ID.';
    dom.lobbyError.classList.remove('hidden');
    return;
  }

  dom.lobbyError.classList.add('hidden');
  state.myUserName = userName;
  state.roomId = roomId;
  dom.joinBtn.disabled = true;
  dom.joinBtn.textContent = 'Connecting...';

  connectAsHostOrGuest();
});

/* 2. PEERJS CONNECTION WITH MULTI-STUN FOR REAL INTERNET CALLS */
const peerConfig = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};

function connectAsHostOrGuest() {
  const hostPeerId = `zoom-live-room-${state.roomId}`;
  const peer = new Peer(hostPeerId, peerConfig);

  peer.on('open', (id) => {
    state.peer = peer;
    state.myPeerId = id;
    state.isHost = true;
    setupPeerListeners(peer);
    enterMeetingRoom();
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      peer.destroy();
      const guestPeer = new Peer(undefined, peerConfig);

      guestPeer.on('open', (guestId) => {
        state.peer = guestPeer;
        state.myPeerId = guestId;
        state.isHost = false;
        setupPeerListeners(guestPeer);
        enterMeetingRoom();
        connectToPeer(hostPeerId, true);
      });

      guestPeer.on('error', (gErr) => {
        console.error('PeerJS Guest Error:', gErr);
        showToast('Connection error. Please try again.');
        resetLobbyButton();
      });
    } else {
      console.error('PeerJS Error:', err);
      dom.lobbyError.textContent = `Connection error: ${err.type}. Check internet connection.`;
      dom.lobbyError.classList.remove('hidden');
      resetLobbyButton();
    }
  });
}

function resetLobbyButton() {
  dom.joinBtn.disabled = false;
  dom.joinBtn.textContent = 'Join Meeting';
}

function setupPeerListeners(peer) {
  peer.on('connection', (conn) => registerDataConnection(conn));

  peer.on('call', (call) => {
    const outgoing = state.isScreenSharing ? state.screenStream : state.localStream;
    call.answer(outgoing);

    call.on('stream', (remoteStream) => {
      const info = state.participants[call.peer] || { userName: 'Participant' };
      createOrUpdateVideoTile(call.peer, remoteStream, info.userName, false);
    });

    call.on('close', () => handlePeerLeave(call.peer));
    state.calls[call.peer] = call;
  });
}

function connectToPeer(targetPeerId, initiateCall = true) {
  if (targetPeerId === state.myPeerId || state.dataConns[targetPeerId]) return;

  const conn = state.peer.connect(targetPeerId, { reliable: true });
  registerDataConnection(conn);

  if (initiateCall) {
    const outgoing = state.isScreenSharing ? state.screenStream : state.localStream;
    const call = state.peer.call(targetPeerId, outgoing);

    call.on('stream', (remoteStream) => {
      const info = state.participants[targetPeerId] || { userName: 'Participant' };
      createOrUpdateVideoTile(targetPeerId, remoteStream, info.userName, false);
    });

    call.on('close', () => handlePeerLeave(targetPeerId));
    state.calls[targetPeerId] = call;
  }
}

function registerDataConnection(conn) {
  conn.on('open', () => {
    state.dataConns[conn.peer] = conn;

    conn.send({
      type: 'hello',
      participant: {
        peerId: state.myPeerId,
        userName: state.myUserName,
        audioEnabled: state.audioEnabled,
        videoEnabled: state.videoEnabled
      }
    });

    if (state.isHost) {
      conn.send({
        type: 'peer-list',
        peerIds: Object.keys(state.participants)
      });
    }
  });

  conn.on('data', (data) => handleDataMessage(conn.peer, data));
  conn.on('close', () => handlePeerLeave(conn.peer));
}

function handleDataMessage(senderPeerId, data) {
  switch (data.type) {
    case 'hello':
      state.participants[senderPeerId] = data.participant;
      updateTileNameAndIndicators(senderPeerId);
      renderParticipantsList();
      break;
    case 'peer-list':
      data.peerIds.forEach((pid) => {
        if (pid !== state.myPeerId) connectToPeer(pid, true);
      });
      break;
    case 'toggle-media':
      if (state.participants[senderPeerId]) {
        if (data.mediaType === 'audio') state.participants[senderPeerId].audioEnabled = data.enabled;
        if (data.mediaType === 'video') state.participants[senderPeerId].videoEnabled = data.enabled;
      }
      updateTileNameAndIndicators(senderPeerId);
      renderParticipantsList();
      break;
    case 'chat':
      appendChatMessage(data.senderName, data.message, data.timestamp, false);
      if (state.activeSidebarTab !== 'chat') {
        state.unreadMessages++;
        dom.chatUnreadDot.classList.remove('hidden');
      }
      break;
    case 'reaction':
      spawnFloatingReaction(data.senderName, data.emoji);
      break;
  }
}

function broadcastData(payload) {
  Object.values(state.dataConns).forEach((conn) => {
    if (conn.open) conn.send(payload);
  });
}

function handlePeerLeave(peerId) {
  if (state.calls[peerId]) {
    state.calls[peerId].close();
    delete state.calls[peerId];
  }
  delete state.dataConns[peerId];
  delete state.participants[peerId];
  removeVideoTile(peerId);
  renderParticipantsList();
}

/* 3. MEETING ROOM & VIDEO TILES */
function enterMeetingRoom() {
  resetLobbyButton();
  dom.lobbyScreen.classList.add('hidden');
  dom.meetingScreen.classList.remove('hidden');
  dom.displayRoomId.textContent = state.roomId;

  // Update URL without reload so copying URL shares the exact room
  const newUrl = `${window.location.pathname}?room=${encodeURIComponent(state.roomId)}`;
  window.history.replaceState({}, '', newUrl);

  startMeetingTimer();
  syncControlBarUI();

  state.participants[state.myPeerId] = {
    peerId: state.myPeerId,
    userName: state.myUserName,
    audioEnabled: state.audioEnabled,
    videoEnabled: state.videoEnabled
  };

  createOrUpdateVideoTile(state.myPeerId, state.localStream, state.myUserName, true);
  renderParticipantsList();
}

function createOrUpdateVideoTile(peerId, stream, userName, isLocal) {
  let tile = document.getElementById(`tile-${peerId}`);

  if (!tile) {
    tile = document.createElement('div');
    tile.id = `tile-${peerId}`;
    tile.className = 'video-tile';

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    if (isLocal) {
      videoEl.muted = true;
      videoEl.classList.add('mirrored');
    }

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'avatar-placeholder hidden';
    avatarDiv.innerHTML = `<span>${userName.charAt(0).toUpperCase()}</span>`;

    const badgeDiv = document.createElement('div');
    badgeDiv.className = 'name-badge';
    badgeDiv.innerHTML = `
      <span class="badge-name">${isLocal ? `${userName} (You)` : userName}</span>
      <i class="fa-solid fa-microphone-slash muted-icon hidden"></i>
    `;

    tile.appendChild(videoEl);
    tile.appendChild(avatarDiv);
    tile.appendChild(badgeDiv);
    dom.videoGrid.appendChild(tile);

    if (stream && stream.getAudioTracks().length > 0) {
      monitorAudioActivity(peerId, stream);
    }
  }

  const videoEl = tile.querySelector('video');
  if (videoEl.srcObject !== stream) videoEl.srcObject = stream;

  updateTileNameAndIndicators(peerId);
}

function updateTileNameAndIndicators(peerId) {
  const tile = document.getElementById(`tile-${peerId}`);
  const info = state.participants[peerId];
  if (!tile || !info) return;

  const isLocal = peerId === state.myPeerId;
  tile.querySelector('.badge-name').textContent = isLocal ? `${info.userName} (You)` : info.userName;
  tile.querySelector('.avatar-placeholder span').textContent = info.userName.charAt(0).toUpperCase();

  const showVideo = info.videoEnabled || (isLocal && state.isScreenSharing);
  tile.querySelector('video').classList.toggle('hidden', !showVideo);
  tile.querySelector('.avatar-placeholder').classList.toggle('hidden', showVideo);
  tile.querySelector('.muted-icon').classList.toggle('hidden', info.audioEnabled);
}

function removeVideoTile(peerId) {
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
}

function monitorAudioActivity(peerId, stream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkVolume = () => {
      const tile = document.getElementById(`tile-${peerId}`);
      if (!tile) { audioCtx.close(); return; }
      const info = state.participants[peerId];
      if (info && info.audioEnabled) {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
        tile.classList.toggle('active-speaker', avg > 18);
      } else {
        tile.classList.remove('active-speaker');
      }
      requestAnimationFrame(checkVolume);
    };
    checkVolume();
  } catch {}
}

/* 4. LIVE FACE & AUDIO RECORDING (MediaRecorder) */
dom.btnRecord.addEventListener('click', () => {
  if (state.isRecording) {
    stopFaceRecording();
  } else {
    startFaceRecording();
  }
});

function startFaceRecording() {
  const activeStream = state.isScreenSharing ? state.screenStream : state.localStream;
  if (!activeStream || activeStream.getTracks().length === 0) {
    showToast('No camera or mic stream available to record.');
    return;
  }

  try {
    state.recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    state.mediaRecorder = new MediaRecorder(activeStream, { mimeType });

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };

    state.mediaRecorder.onstop = () => {
      const blob = new Blob(state.recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `zoom-face-recording-${state.roomId}-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
      showToast('Recording saved to your device!');
    };

    state.mediaRecorder.start(1000);
    state.isRecording = true;
    syncControlBarUI();

    // Start REC badge timer
    state.recSeconds = 0;
    dom.recTimer.textContent = '00:00';
    dom.recIndicator.classList.remove('hidden');
    state.recInterval = setInterval(() => {
      state.recSeconds++;
      const m = String(Math.floor(state.recSeconds / 60)).padStart(2, '0');
      const s = String(state.recSeconds % 60).padStart(2, '0');
      dom.recTimer.textContent = `${m}:${s}`;
    }, 1000);

    showToast('Recording started');
  } catch (err) {
    console.error('Recording failed:', err);
    showToast('Recording not supported on this browser.');
  }
}

function stopFaceRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;
  state.mediaRecorder.stop();
  state.isRecording = false;
  clearInterval(state.recInterval);
  dom.recIndicator.classList.add('hidden');
  syncControlBarUI();
}

/* 5. CONTROL BAR ACTIONS */
function syncControlBarUI() {
  dom.btnMic.classList.toggle('danger', !state.audioEnabled);
  dom.btnMic.innerHTML = state.audioEnabled
    ? '<i class="fa-solid fa-microphone"></i><span>Mute</span>'
    : '<i class="fa-solid fa-microphone-slash"></i><span>Unmute</span>';

  dom.btnCam.classList.toggle('danger', !state.videoEnabled);
  dom.btnCam.innerHTML = state.videoEnabled
    ? '<i class="fa-solid fa-video"></i><span>Stop Video</span>'
    : '<i class="fa-solid fa-video-slash"></i><span>Start Video</span>';

  dom.btnScreen.classList.toggle('success', state.isScreenSharing);
  dom.btnScreen.innerHTML = state.isScreenSharing
    ? '<i class="fa-solid fa-stop-circle"></i><span>Stop Share</span>'
    : '<i class="fa-solid fa-display"></i><span>Share Screen</span>';

  dom.btnRecord.classList.toggle('danger', state.isRecording);
  dom.btnRecord.innerHTML = state.isRecording
    ? '<i class="fa-solid fa-stop"></i><span>Stop Rec</span>'
    : '<i class="fa-solid fa-record-vinyl"></i><span>Record</span>';
}

dom.btnMic.addEventListener('click', () => {
  const t = state.localStream?.getAudioTracks()[0];
  if (!t) return;
  state.audioEnabled = !state.audioEnabled;
  t.enabled = state.audioEnabled;
  if (state.participants[state.myPeerId]) state.participants[state.myPeerId].audioEnabled = state.audioEnabled;

  syncControlBarUI();
  updateTileNameAndIndicators(state.myPeerId);
  renderParticipantsList();
  broadcastData({ type: 'toggle-media', mediaType: 'audio', enabled: state.audioEnabled });
});

dom.btnCam.addEventListener('click', () => {
  const t = state.localStream?.getVideoTracks()[0];
  if (!t) return;
  state.videoEnabled = !state.videoEnabled;
  t.enabled = state.videoEnabled;
  if (state.participants[state.myPeerId]) state.participants[state.myPeerId].videoEnabled = state.videoEnabled;

  syncControlBarUI();
  updateTileNameAndIndicators(state.myPeerId);
  renderParticipantsList();
  broadcastData({ type: 'toggle-media', mediaType: 'video', enabled: state.videoEnabled });
});

dom.btnScreen.addEventListener('click', async () => {
  if (state.isScreenSharing) { stopScreenSharing(); return; }
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = state.screenStream.getVideoTracks()[0];
    state.isScreenSharing = true;
    syncControlBarUI();
    replaceOutgoingVideoTrack(screenTrack);

    const localTile = document.getElementById(`tile-${state.myPeerId}`);
    if (localTile) {
      const videoEl = localTile.querySelector('video');
      videoEl.srcObject = state.screenStream;
      videoEl.classList.remove('mirrored');
    }
    updateTileNameAndIndicators(state.myPeerId);
    screenTrack.onended = () => stopScreenSharing();
  } catch {}
});

function stopScreenSharing() {
  if (!state.isScreenSharing) return;
  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
  }
  state.isScreenSharing = false;
  syncControlBarUI();

  const cameraTrack = state.localStream?.getVideoTracks()[0];
  if (cameraTrack) replaceOutgoingVideoTrack(cameraTrack);

  const localTile = document.getElementById(`tile-${state.myPeerId}`);
  if (localTile) {
    const videoEl = localTile.querySelector('video');
    videoEl.srcObject = state.localStream;
    videoEl.classList.add('mirrored');
  }
  updateTileNameAndIndicators(state.myPeerId);
}

function replaceOutgoingVideoTrack(newTrack) {
  Object.values(state.calls).forEach((call) => {
    const sender = call.peerConnection?.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(newTrack);
  });
}

// Reactions
dom.btnReactions.addEventListener('click', (e) => {
  e.stopPropagation();
  dom.reactionPicker.classList.toggle('hidden');
});
document.addEventListener('click', () => dom.reactionPicker.classList.add('hidden'));

document.querySelectorAll('.emoji-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    spawnFloatingReaction(state.myUserName, emoji);
    broadcastData({ type: 'reaction', senderName: state.myUserName, emoji });
    dom.reactionPicker.classList.add('hidden');
  });
});

function spawnFloatingReaction(senderName, emoji) {
  const item = document.createElement('div');
  item.className = 'floating-reaction';
  item.style.left = `${Math.floor(Math.random() * 160) + 10}px`;
  item.innerHTML = `<span class="emoji">${emoji}</span><span class="sender">${senderName}</span>`;
  dom.reactionsLayer.appendChild(item);
  setTimeout(() => item.remove(), 2900);
}

// Sidebar Toggles
function toggleSidebar(tabName) {
  if (state.activeSidebarTab === tabName) {
    state.activeSidebarTab = null;
    dom.rightSidebar.classList.add('collapsed');
  } else {
    state.activeSidebarTab = tabName;
    dom.rightSidebar.classList.remove('collapsed');
    const isChat = tabName === 'chat';
    dom.tabChat.classList.toggle('active', isChat);
    dom.tabParticipants.classList.toggle('active', !isChat);
    dom.panelChat.classList.toggle('hidden', !isChat);
    dom.panelParticipants.classList.toggle('hidden', isChat);
    if (isChat) {
      state.unreadMessages = 0;
      dom.chatUnreadDot.classList.add('hidden');
      dom.chatInput.focus();
    }
  }
  dom.btnChat.classList.toggle('active-tab', state.activeSidebarTab === 'chat');
  dom.btnParticipants.classList.toggle('active-tab', state.activeSidebarTab === 'participants');
}

dom.btnParticipants.addEventListener('click', () => toggleSidebar('participants'));
dom.btnChat.addEventListener('click', () => toggleSidebar('chat'));
dom.tabChat.addEventListener('click', () => toggleSidebar('chat'));
dom.tabParticipants.addEventListener('click', () => toggleSidebar('participants'));
dom.closeSidebarBtn.addEventListener('click', () => {
  state.activeSidebarTab = null;
  dom.rightSidebar.classList.add('collapsed');
  dom.btnChat.classList.remove('active-tab');
  dom.btnParticipants.classList.remove('active-tab');
});

// Copy Full Shareable Invite Link
dom.copyRoomBtn.addEventListener('click', async () => {
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.roomId)}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Invite Link Copied!');
  } catch {
    showToast(`Room ID: ${state.roomId}`);
  }
});

function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.remove('hidden');
  setTimeout(() => dom.toast.classList.add('hidden'), 2200);
}

// Timer
function startMeetingTimer() {
  state.secondsElapsed = 0;
  dom.meetingTimer.textContent = '00:00';
  state.timerInterval = setInterval(() => {
    state.secondsElapsed++;
    const m = String(Math.floor(state.secondsElapsed / 60)).padStart(2, '0');
    const s = String(state.secondsElapsed % 60).padStart(2, '0');
    dom.meetingTimer.textContent = `${m}:${s}`;
  }, 1000);
}

// Chat
dom.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = dom.chatInput.value.trim();
  if (!message) return;
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  appendChatMessage(state.myUserName, message, timestamp, true);
  broadcastData({ type: 'chat', senderName: state.myUserName, message, timestamp });
  dom.chatInput.value = '';
});

function appendChatMessage(senderName, message, timestamp, isOwn) {
  const wrap = document.createElement('div');
  wrap.className = `chat-bubble-wrap ${isOwn ? 'own' : 'other'}`;
  wrap.innerHTML = `<div class="chat-meta">${isOwn ? 'You' : senderName} • ${timestamp}</div><div class="chat-bubble"></div>`;
  wrap.querySelector('.chat-bubble').textContent = message;
  dom.chatMessages.appendChild(wrap);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// Participants List
function renderParticipantsList() {
  const list = Object.values(state.participants);
  dom.participantBadge.textContent = list.length;
  dom.participantCountHeader.textContent = list.length;
  dom.participantsList.innerHTML = '';

  list.forEach((p) => {
    const isMe = p.peerId === state.myPeerId;
    const li = document.createElement('li');
    li.className = 'participant-item';
    li.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar-sm">${p.userName.charAt(0).toUpperCase()}</div>
        <span class="participant-name">${p.userName} ${isMe ? '(You)' : ''}</span>
      </div>
      <div class="participant-status-icons">
        <i class="fa-solid ${p.audioEnabled ? 'fa-microphone' : 'fa-microphone-slash off'}"></i>
        <i class="fa-solid ${p.videoEnabled ? 'fa-video' : 'fa-video-slash off'}"></i>
      </div>
    `;
    dom.participantsList.appendChild(li);
  });
}

// Leave Call
dom.btnLeave.addEventListener('click', () => {
  if (state.isRecording) stopFaceRecording();

  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
    state.isScreenSharing = false;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  Object.values(state.calls).forEach((call) => call.close());
  Object.values(state.dataConns).forEach((conn) => conn.close());
  state.calls = {};
  state.dataConns = {};

  if (state.peer) {
    state.peer.destroy();
    state.peer = null;
  }

  clearInterval(state.timerInterval);
  dom.videoGrid.innerHTML = '';
  dom.chatMessages.innerHTML = '<div class="chat-system-msg">Messages are visible to everyone in the call.</div>';
  state.participants = {};
  state.activeSidebarTab = null;
  dom.rightSidebar.classList.add('collapsed');
  dom.meetingScreen.classList.add('hidden');
  dom.lobbyScreen.classList.remove('hidden');
  state.audioEnabled = true;
  state.videoEnabled = true;
  initLobbyPreview();
});

initLobbyPreview();