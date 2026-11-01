/**
 * ALYA — D-ID AI Avatar Meeting Interface
 * Zoom-style WebRTC meeting using D-ID Client SDK v3
 */

import * as sdk from '@d-id/client-sdk';

// ── Config ────────────────────────────────────────────────────────────────
const AGENT_ID   = 'v2_agt_yRp2j9r2';
// API key used via SDK basic auth (safe here since this is a local dev build)
const API_USER   = 'Z29vZ2xlLW9hdXRoMnwxMDkyMzYxOTQ3ODAzNTI5OTI3MDdAYWtfMFQtb1ZjTE9vVDJvaTd6SkU1OXN2';
const API_PASS   = 'f7HBRaBF-mwxkTiqbdpAM';

// ── State ─────────────────────────────────────────────────────────────────
let agentManager  = null;
let srcObject     = null;
let meetingStart  = null;
let timerInterval = null;
let micEnabled    = true;
let camEnabled    = true;
let userStream    = null;
let speechRec     = null;
let isRecording   = false;
let unreadCount   = 0;
let chatOpen      = false;
let userName      = 'You';
let agentName     = 'ALYA';

// ── DOM refs ──────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);

const agentVideo      = $('agent-video');
const userVideo       = $('user-video');
const userFallback    = $('user-fallback');
const userInitial     = $('user-initial');
const userLabel       = $('user-label');
const agentLabel      = $('agent-label');
const agentBadge      = $('agent-badge');
const agentTile       = $('agent-tile');
const speakingBars    = $('agent-speaking-bars');
const meetingTimer    = $('meeting-timer');
const headerTitle     = $('header-title');
const connectOverlay  = $('connect-overlay');
const connectStatus   = $('connect-status');
const chatPanel       = $('chat-panel');
const chatMessages    = $('chat-messages');
const chatInput       = $('chat-input');
const chatTyping      = $('chat-typing');
const chatUnread      = $('chat-unread');
const endDuration     = $('end-duration');
const voiceLabel      = $('voice-label');

const btnJoin        = $('join-btn');
const btnMic         = $('btn-mic');
const btnCam         = $('btn-cam');
const btnVoice       = $('btn-voice');
const btnChat        = $('btn-chat');
const btnCloseChat   = $('btn-close-chat');
const btnSend        = $('btn-send');
const btnEnd         = $('btn-end');
const btnNewMeeting  = $('btn-new-meeting');
const btnPip         = $('btn-pip');
const userNameInput  = $('user-name-input');

// ── Screen management ─────────────────────────────────────────────────────
function showScreen(id) {
  ['join-screen', 'meeting-screen', 'end-screen'].forEach(sid => {
    const el = $(sid);
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const target = $(id);
  target.style.display = 'flex';
  target.classList.add('active');
}

// ── Timer ─────────────────────────────────────────────────────────────────
function formatTime(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(sec % 60).padStart(2,'0')}`;
}
function startTimer() {
  meetingStart = Date.now();
  timerInterval = setInterval(() => {
    meetingTimer.textContent = formatTime(Math.floor((Date.now() - meetingStart) / 1000));
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  return formatTime(Math.floor((Date.now() - meetingStart) / 1000));
}

// ── Overlay ───────────────────────────────────────────────────────────────
function showOverlay(text) {
  connectStatus.textContent = text;
  connectOverlay.style.display = 'flex';
  connectOverlay.style.opacity  = '1';
}
function hideOverlay() {
  connectOverlay.style.opacity = '0';
  setTimeout(() => { connectOverlay.style.display = 'none'; }, 400);
}

// ── Speaking state ────────────────────────────────────────────────────────
function setSpeaking(active) {
  speakingBars.classList.toggle('active', active);
  agentTile.classList.toggle('speaking', active);
}

// ── Badge ─────────────────────────────────────────────────────────────────
function setBadge(text, hide = false) {
  agentBadge.textContent = text;
  agentBadge.style.display = hide ? 'none' : 'block';
}

// ── Chat ──────────────────────────────────────────────────────────────────
function addMessage(content, role) {
  const div = document.createElement('div');
  div.className = `chat-msg msg-${role}`;

  const sender = document.createElement('div');
  sender.className = 'msg-sender';
  sender.textContent = role === 'user' ? userName : agentName;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = content;

  div.appendChild(sender);
  div.appendChild(bubble);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (role === 'agent' && !chatOpen) {
    unreadCount++;
    chatUnread.textContent = unreadCount;
    chatUnread.classList.remove('hidden');
  }
}

function openChat() {
  chatOpen = true;
  chatPanel.classList.add('open');
  unreadCount = 0;
  chatUnread.classList.add('hidden');
  setTimeout(() => chatInput.focus(), 320);
}
function closeChat() {
  chatOpen = false;
  chatPanel.classList.remove('open');
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || !agentManager) return;
  addMessage(text, 'user');
  chatInput.value = '';
  chatTyping.classList.add('visible');
  try {
    await agentManager.chat(text);
  } catch (err) {
    console.error('chat() error:', err);
    chatTyping.classList.remove('visible');
    addMessage('Sorry, I had trouble responding. Please try again.', 'agent');
  }
}

// ── Speech recognition ────────────────────────────────────────────────────
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    voiceLabel.textContent = 'Not available';
    btnVoice.disabled = true;
    return;
  }
  speechRec = new SR();
  speechRec.continuous = false;
  speechRec.interimResults = false;
  speechRec.lang = 'en-US';

  speechRec.onresult = e => {
    const t = e.results[0][0].transcript.trim();
    if (t) sendMessage(t);
  };
  speechRec.onerror  = () => stopVoice();
  speechRec.onend    = () => stopVoice();
}

function startVoice() {
  if (!speechRec || isRecording) return;
  isRecording = true;
  btnVoice.classList.add('recording');
  voiceLabel.textContent = 'Listening…';
  try { speechRec.start(); } catch (_) { stopVoice(); }
  // safety timeout
  setTimeout(() => { if (isRecording) stopVoice(); }, 12000);
}
function stopVoice() {
  if (!isRecording) return;
  isRecording = false;
  btnVoice.classList.remove('recording');
  voiceLabel.textContent = 'Hold to Talk';
  try { speechRec?.stop(); } catch (_) {}
}

// ── Camera & mic ──────────────────────────────────────────────────────────
async function startUserMedia() {
  try {
    userStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    userVideo.srcObject = userStream;
    userFallback.style.display = 'none';
  } catch {
    try { userStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) {}
    userFallback.style.display = 'flex';
  }
}

function toggleMic() {
  micEnabled = !micEnabled;
  userStream?.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
  btnMic.classList.toggle('muted', !micEnabled);
  btnMic.querySelector('.icon-mic-on').classList.toggle('hidden', !micEnabled);
  btnMic.querySelector('.icon-mic-off').classList.toggle('hidden',  micEnabled);
  btnMic.querySelector('span:last-child').textContent = micEnabled ? 'Mute' : 'Unmute';
  $('mic-off-badge').classList.toggle('hidden', micEnabled);
}

function toggleCam() {
  camEnabled = !camEnabled;
  userStream?.getVideoTracks().forEach(t => { t.enabled = camEnabled; });
  const hasVid = userStream?.getVideoTracks().length > 0;
  userFallback.style.display = (!camEnabled || !hasVid) ? 'flex' : 'none';
  btnCam.classList.toggle('cam-off', !camEnabled);
  btnCam.querySelector('.icon-cam-on').classList.toggle('hidden', !camEnabled);
  btnCam.querySelector('.icon-cam-off').classList.toggle('hidden',  camEnabled);
  btnCam.querySelector('span:last-child').textContent = camEnabled ? 'Stop video' : 'Start video';
}

// ── Draggable user tile ───────────────────────────────────────────────────
function makeDraggable(el) {
  let ox = 0, oy = 0;
  const grid = () => $('video-grid').getBoundingClientRect();

  function onDown(cx, cy) {
    const r = el.getBoundingClientRect();
    ox = cx - r.left; oy = cy - r.top;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }
  function onMove(e) {
    const g = grid();
    const x = Math.min(Math.max(e.clientX - g.left - ox, 0), g.width  - el.offsetWidth);
    const y = Math.min(Math.max(e.clientY - g.top  - oy, 0), g.height - el.offsetHeight);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  }
  el.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
  el.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onDown(t.clientX, t.clientY);
    document.addEventListener('touchmove', tm => {
      onMove(tm.touches[0]);
    }, { passive: true });
    document.addEventListener('touchend', onUp, { once: true });
  }, { passive: true });
}

// ── PiP ───────────────────────────────────────────────────────────────────
async function togglePiP() {
  try {
    document.pictureInPictureElement
      ? await document.exitPictureInPicture()
      : await agentVideo.requestPictureInPicture();
  } catch (e) { console.warn('PiP:', e); }
}

// ── D-ID Agent ────────────────────────────────────────────────────────────
async function connectAgent() {
  showOverlay('Connecting to ALYA…');

  try {
    agentManager = await sdk.createAgentManager(AGENT_ID, {
      auth: { type: 'basic', username: API_USER, password: API_PASS },
      streamOptions: { compatibilityMode: 'auto' },
      callbacks: {

        onSrcObjectReady(value) {
          srcObject = value;
          agentVideo.srcObject = value;
          agentVideo.src = '';
        },

        // V2 (Legacy) agents swap between idle video and the live stream
        onVideoStateChange(state) {
          if (agentManager.getStreamType() !== sdk.StreamType.Legacy) return;
          if (state === sdk.StreamingState.Stop) {
            agentVideo.srcObject = null;
            agentVideo.src = agentManager.agent?.presenter?.idle_video
                          ?? agentManager.agent?.idle_video
                          ?? '';
            setSpeaking(false);
          } else {
            agentVideo.src = '';
            agentVideo.srcObject = srcObject ?? null;
            setSpeaking(true);
          }
        },

        onConnectionStateChange(state, reason) {
          console.log('[D-ID] connection:', state, reason ?? '');
          if (state === sdk.ConnectionState.Connected) {
            hideOverlay();
            setBadge('', true);
            startTimer();
            // Greet the user
            setTimeout(() => {
              agentManager.speak({
                type: 'text',
                input: `Hello ${userName}! I'm ${agentName}. How can I help you today?`
              }).catch(console.warn);
            }, 600);
          } else if (state === sdk.ConnectionState.Connecting) {
            showOverlay('Establishing connection…');
          } else if (state === sdk.ConnectionState.Fail) {
            setBadge('Connection failed — retrying…');
            showOverlay('Connection failed. Retrying…');
            setTimeout(connectAgent, 4000);
          } else if (state === sdk.ConnectionState.Disconnected || state === sdk.ConnectionState.Closed) {
            setSpeaking(false);
            setBadge('Disconnected');
          }
        },

        // V4 (Expressive) agents use this instead of onVideoStateChange
        onAgentActivityStateChange(state) {
          setSpeaking(state === sdk.AgentActivityState.Talking);
          if (state === sdk.AgentActivityState.Loading) {
            chatTyping.classList.add('visible');
          } else {
            chatTyping.classList.remove('visible');
          }
        },

        onNewMessage(messages, type) {
          chatTyping.classList.remove('visible');
          if (type === 'answer') {
            const last = messages[messages.length - 1];
            if (last?.content) addMessage(last.content, 'agent');
          }
        },

        onError(error, errorData) {
          console.error('[D-ID] error:', error, errorData);
          chatTyping.classList.remove('visible');
        }
      }
    });

    // Sync agent name from profile
    agentName = agentManager.agent?.preview_name ?? 'ALYA';
    agentLabel.textContent  = agentName;
    headerTitle.textContent = `Meeting with ${agentName}`;

    showOverlay('Joining meeting…');
    await agentManager.connect();

  } catch (err) {
    console.error('[D-ID] createAgentManager / connect failed:', err);
    showOverlay('Connection failed. Retrying in 4s…');
    setTimeout(connectAgent, 4000);
  }
}

// ── End meeting ───────────────────────────────────────────────────────────
async function endMeeting() {
  const duration = stopTimer();
  endDuration.textContent = `Duration: ${duration}`;

  userStream?.getTracks().forEach(t => t.stop());
  userStream = null;
  speechRec?.abort();

  if (agentManager) {
    try { await agentManager.disconnect(); } catch (_) {}
    agentManager = null;
  }

  agentVideo.srcObject = null;
  agentVideo.src = '';
  userVideo.srcObject = null;

  showScreen('end-screen');
}

// ── Join ──────────────────────────────────────────────────────────────────
async function joinMeeting() {
  userName = userNameInput.value.trim() || 'You';
  userLabel.textContent  = userName;
  userInitial.textContent = userName.charAt(0).toUpperCase();

  btnJoin.disabled = true;

  showScreen('meeting-screen');
  showOverlay('Starting camera…');

  await startUserMedia();
  initSpeechRecognition();
  makeDraggable($('user-tile'));

  await connectAgent();
}

// ── Reset for new meeting ─────────────────────────────────────────────────
function resetForNewMeeting() {
  btnJoin.disabled = false;
  chatMessages.innerHTML = '';
  unreadCount = 0;
  chatUnread.classList.add('hidden');
  micEnabled = camEnabled = true;
  btnMic.classList.remove('muted');
  btnMic.querySelector('.icon-mic-on').classList.remove('hidden');
  btnMic.querySelector('.icon-mic-off').classList.add('hidden');
  btnMic.querySelector('span:last-child').textContent = 'Mute';
  btnCam.classList.remove('cam-off');
  btnCam.querySelector('.icon-cam-on').classList.remove('hidden');
  btnCam.querySelector('.icon-cam-off').classList.add('hidden');
  btnCam.querySelector('span:last-child').textContent = 'Stop video';
  meetingTimer.textContent = '00:00';
  showScreen('join-screen');
}

// ── Event listeners ───────────────────────────────────────────────────────
btnJoin.addEventListener('click', joinMeeting);
userNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinMeeting(); });

btnMic.addEventListener('click', toggleMic);
btnCam.addEventListener('click', toggleCam);

btnVoice.addEventListener('mousedown',  startVoice);
btnVoice.addEventListener('mouseup',    stopVoice);
btnVoice.addEventListener('mouseleave', stopVoice);
btnVoice.addEventListener('touchstart', e => { e.preventDefault(); startVoice(); }, { passive: false });
btnVoice.addEventListener('touchend',   stopVoice);

btnChat.addEventListener('click',      () => chatOpen ? closeChat() : openChat());
btnCloseChat.addEventListener('click', closeChat);
btnSend.addEventListener('click',      () => sendMessage(chatInput.value));
chatInput.addEventListener('keydown',  e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput.value); }});

btnEnd.addEventListener('click',       endMeeting);
btnNewMeeting.addEventListener('click', resetForNewMeeting);
btnPip.addEventListener('click',       togglePiP);

window.addEventListener('beforeunload', () => {
  userStream?.getTracks().forEach(t => t.stop());
  agentManager?.disconnect().catch(() => {});
});
