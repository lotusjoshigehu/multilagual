// ================= VOICE =================

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();

recognition.continuous = true;
recognition.interimResults = false;
recognition.maxAlternatives = 1;

let bufferText = "";
let timeout = null;
let isCallActive = false;
let user = JSON.parse(localStorage.getItem("user"));
let currentRoom = null;
let isListening = false;

// Shared ICE server config
const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
    },
    {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
    },
    {
        urls: "turns:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
    }
];

function start() {
    const inputLang = document.getElementById("inputLang").value;
    recognition.lang = inputLang || "en-US";
    recognition.start();
}

function showSubtitle(text, isLocal = true) {
    if (!isCallActive) return;
    const box = document.getElementById("subtitleBox");
    box.innerHTML = `
        <div style="color:${isLocal ? "cyan" : "yellow"}; font-size:18px;">
            ${isLocal ? "You" : "Other"}: ${text}
        </div>
    `;
}

// ================= TRANSLATION =================

recognition.onresult = function(event) {
    let text = event.results[event.results.length - 1][0].transcript.trim();
    if (!text) return;
    bufferText += " " + text;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
        processSentence(bufferText.trim());
        bufferText = "";
    }, 1200);
};

recognition.onerror = function(event) {
    console.error("Speech recognition error:", event.error);
    if (event.error === "not-allowed") {
        alert("Microphone permission denied. Please allow mic access.");
    }
};

recognition.onend = function() {
    if (isListening) {
        recognition.start();
    }
};

async function processSentence(text) {
    document.getElementById("inputText").innerText = text;
    showSubtitle(text, true);
    const target = document.getElementById("outputLang").value;
    try {
        const res = await fetch("https://multilagual.onrender.com/translate", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ text, target })
        });
        const data = await res.json();
        document.getElementById("outputText").innerText = data.translated;
        if (currentRoom) {
            socket.emit("send-translation-room", {
                roomId: currentRoom,
                text: data.translated,
                lang: target
            });
        } else if (targetSocketId) {
            socket.emit("send-translation", {
                to: targetSocketId,
                text: data.translated,
                lang: target
            });
        }
    } catch (err) {
        console.error(err);
    }
}

// ================= SOCKET =================

const socket = io("https://multilagual.onrender.com");

let localStream;
let peers = {};
let peer = null;
let targetSocketId = "";
let pendingCandidates = {};  // buffer ICE candidates until remote desc is ready

let isMuted = false;
let isCameraOff = false;
let incomingOffer = null;
let incomingFrom = null;

socket.on("connect", () => {
    if (user && user.email) {
        socket.emit("register", user.email);
        console.log("Registered:", user.email);
    }
});

socket.on("join-success", (roomId) => {
    currentRoom = roomId;
    isCallActive = true;
    document.getElementById("meetingInfo").innerText = "Joined: " + roomId;
    document.getElementById("subtitleBox").style.display = "block";
});

socket.on("join-error", (msg) => {
    alert(msg);
});

// ================= AUTO REGISTER =================

window.onload = function () {
    user = JSON.parse(localStorage.getItem("user"));

    if (!user || !user.email) {
        window.location.href = "login.html";
        return;
    }

    document.getElementById("myEmail") && (document.getElementById("myEmail").value = user.email);
    document.getElementById("nameInput").value = user.name || "";
    document.getElementById("emailInput").value = user.email || "";

    const welcome = document.getElementById("welcomeUser");
    if (welcome) welcome.innerText = "Hi, " + (user.name || "User") + " 👋";

    if (user.photo) document.getElementById("profilePic").src = user.photo;

    const btn = document.getElementById("startSpeaking");
    btn.addEventListener("click", () => {
        if (!isListening) {
            isListening = true;
            const inputLang = document.getElementById("inputLang").value;
            recognition.lang = inputLang || "en-US";
            recognition.start();
            btn.textContent = "🛑 Stop Speaking";
            btn.style.background = "linear-gradient(135deg, #ef4444, #b91c1c)";
        } else {
            isListening = false;
            recognition.stop();
            btn.textContent = "🎙️ Start Speaking";
            btn.style.background = "";
        }
    });

    // ResizeObserver — recalculate grid when container gets real size
    const observer = new ResizeObserver(() => updateVideoGrid());
    observer.observe(document.getElementById("videoContainer"));

    showPage("home");
};

// ================= CAMERA =================

async function initVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        });
        const video = document.getElementById("localVideo");
        video.srcObject = localStream;
        video.muted = true;
        video.play().catch(() => {});
        console.log("Camera working");
    } catch (err) {
        console.error(err);
        alert("Allow camera permission");
    }
}
initVideo();

// ================= CALL =================

async function startCall() {
    if (!localStream) { alert("Camera not ready"); return; }
    const targetEmail = document.getElementById("targetEmail")?.value;
    if (!targetEmail) { alert("Enter target email"); return; }

    document.getElementById("callState").innerText = "Calling...";
    document.getElementById("callSetup").style.display = "none";
    document.getElementById("callControls").style.display = "flex";

    peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = (event) => addRemoteVideo(event.streams[0], "remoteVideo");
    peer.onicecandidate = (event) => {
        if (event.candidate && targetSocketId) {
            socket.emit("ice-candidate", { to: targetSocketId, candidate: event.candidate });
        }
    };
    peer.oniceconnectionstatechange = () => {
        console.log("ICE state:", peer.iceConnectionState);
        if (peer.iceConnectionState === "failed") peer.restartIce();
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("call-user", { to: targetEmail, offer });
}

// ================= ADD REMOTE VIDEO =================

function addRemoteVideo(stream, id) {
    console.log("addRemoteVideo called:", id, stream);
    if (document.getElementById(id)) {
        console.log("Video element already exists:", id);
        return;
    }
    const video = document.createElement("video");
    video.id = id;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.className = "remote-video";
    document.getElementById("videoContainer").appendChild(video);
    video.srcObject = stream;
    video.play().then(() => {
        console.log("Video playing:", id);
    }).catch(err => {
        console.error("Video play error:", id, err);
    });
    updateVideoGrid();
}

// ================= VIDEO GRID (Zoom-style) =================

function updateVideoGrid() {
    const container = document.getElementById("videoContainer");
    const videos = container.querySelectorAll("video");
    const count = videos.length;

    if (count === 0) return;

    let cols, rows;
    if      (count === 1)  { cols = 1; rows = 1; }
    else if (count === 2)  { cols = 2; rows = 1; }
    else if (count === 3)  { cols = 2; rows = 2; }
    else if (count === 4)  { cols = 2; rows = 2; }
    else if (count === 5)  { cols = 3; rows = 2; }
    else if (count === 6)  { cols = 3; rows = 2; }
    else if (count <= 9)   { cols = 3; rows = 3; }
    else if (count <= 12)  { cols = 4; rows = 3; }
    else if (count <= 16)  { cols = 4; rows = 4; }
    else if (count <= 25)  { cols = 5; rows = 5; }
    else                   { cols = 6; rows = Math.ceil(count / 6); }

    const gap = 8;
    const pad = 10;
    const W = container.offsetWidth;
    const H = container.offsetHeight;

    if (!W || !H) return;

    const cellW = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols);
    const cellH = Math.floor((H - pad * 2 - gap * (rows - 1)) / rows);

    container.style.display             = "grid";
    container.style.gridTemplateColumns = `repeat(${cols}, ${cellW}px)`;
    container.style.gridTemplateRows    = `repeat(${rows}, ${cellH}px)`;
    container.style.gap                 = `${gap}px`;
    container.style.padding             = `${pad}px`;
    container.style.alignContent        = "center";
    container.style.justifyContent      = "center";
    container.style.width               = "100%";
    container.style.height              = "100%";
    container.style.boxSizing           = "border-box";
    container.style.overflow            = "hidden";

    videos.forEach((v, i) => {
        v.style.width        = "100%";
        v.style.height       = "100%";
        v.style.objectFit    = "contain";
        v.style.borderRadius = "12px";
        v.style.background   = "#0f172a";
        v.style.display      = "block";
        v.style.minHeight    = "0";

        if (count === 3 && i === 2) {
            v.style.gridColumn = "1 / -1";
            v.style.width      = `${cellW}px`;
            v.style.margin     = "0 auto";
        } else if (count === 5 && i === 4) {
            v.style.gridColumn = "2 / 3";
            v.style.width      = `${cellW}px`;
            v.style.margin     = "0 auto";
        } else {
            v.style.gridColumn = "";
            v.style.margin     = "";
        }
    });
}

// ================= ICE CANDIDATE BUFFER =================

// Flush buffered ICE candidates after remote description is set
async function flushCandidates(socketId) {
    const candidates = pendingCandidates[socketId];
    if (!candidates || !candidates.length) return;
    for (const candidate of candidates) {
        try {
            await peers[socketId].addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("flushCandidates error:", err);
        }
    }
    delete pendingCandidates[socketId];
}

// ================= CREATE PEER =================

function createPeer(socketId) {
    const p = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    p.ontrack = (event) => {
        console.log("ontrack fired for:", socketId, event.streams);
        const stream = event.streams[0];
        if (!stream) {
            console.warn("No stream in ontrack event");
            return;
        }
        if (localStream && stream.id === localStream.id) {
            console.warn("Skipping local stream");
            return;
        }
        console.log("Adding remote video for:", socketId);
        addRemoteVideo(stream, socketId);
    };

    p.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("room-ice", { to: socketId, candidate: event.candidate });
        }
    };

    p.oniceconnectionstatechange = () => {
        console.log(`[${socketId}] ICE:`, p.iceConnectionState);
        if (p.iceConnectionState === "failed") p.restartIce();
    };

    p.onconnectionstatechange = () => {
        console.log(`[${socketId}] Connection:`, p.connectionState);
    };

    p.onsignalingstatechange = () => {
        console.log(`[${socketId}] Signaling:`, p.signalingState);
    };

    return p;
}

// ================= SOCKET EVENTS =================

socket.on("user-found", ({ socketId }) => {
    targetSocketId = socketId;
});

socket.on("room-offer", async ({ from, offer }) => {
    console.log("Received room-offer from:", from);   // ← add this
    if (peers[from]) return;
    const newPeer = createPeer(from);
    peers[from] = newPeer;

    if (!localStream) {
        console.warn("localStream not ready on room-offer, waiting...");
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (localStream) { clearInterval(check); resolve(); }
            }, 200);
        });
    }

    localStream.getTracks().forEach(track => newPeer.addTrack(track, localStream));
    try {
        await newPeer.setRemoteDescription(new RTCSessionDescription(offer));
        await flushCandidates(from);
        const answer = await newPeer.createAnswer();
        await newPeer.setLocalDescription(answer);
        socket.emit("room-answer", { to: from, answer });
        console.log("Sent room-answer to:", from);   // ← add this
    } catch (err) {
        console.error("room-offer error:", err);
    }
});

socket.on("room-answer", async ({ from, answer }) => {
    if (!peers[from]) return;
    if (peers[from].signalingState !== "have-local-offer") return;
    try {
        await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
        await flushCandidates(from);    // apply any buffered ICE candidates
    } catch (err) {
        console.error("room-answer error:", err);
    }
});

socket.on("room-ice", async ({ from, candidate }) => {
    // If peer doesn't exist or remote desc not set yet — buffer the candidate
    if (!peers[from] || !peers[from].remoteDescription) {
        if (!pendingCandidates[from]) pendingCandidates[from] = [];
        pendingCandidates[from].push(candidate);
        return;
    }
    try {
        await peers[from].addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error("room-ice error:", err);
    }
});

socket.on("incoming-call", ({ from, offer }) => {
    incomingOffer = offer;
    incomingFrom = from;
    console.log("Incoming call from:", from);
});

socket.on("user-joined", async ({ socketId }) => {
    if (peers[socketId]) return;

    // Wait for localStream if camera not ready yet
    if (!localStream) {
        console.warn("localStream not ready, waiting...");
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (localStream) { clearInterval(check); resolve(); }
            }, 200);
        });
    }

    const newPeer = createPeer(socketId);
    peers[socketId] = newPeer;
    localStream.getTracks().forEach(track => newPeer.addTrack(track, localStream));
    const offer = await newPeer.createOffer();
    await newPeer.setLocalDescription(offer);
    socket.emit("room-offer", { to: socketId, offer });
    console.log("Sent room-offer to:", socketId);
});

// ================= ACCEPT =================

async function acceptCall() {
    isCallActive = true;
    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    document.getElementById("callSetup").style.display = "none";
    document.getElementById("callControls").style.display = "flex";

    targetSocketId = incomingFrom;

    peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = (event) => addRemoteVideo(event.streams[0], "remoteVideo");
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", { to: incomingFrom, candidate: event.candidate });
        }
    };
    peer.oniceconnectionstatechange = () => {
        console.log("ICE state:", peer.iceConnectionState);
        if (peer.iceConnectionState === "failed") peer.restartIce();
    };

    try {
        await peer.setRemoteDescription(new RTCSessionDescription(incomingOffer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("answer-call", { to: incomingFrom, answer });
    } catch (err) {
        console.error("acceptCall error:", err);
    }
}

// ================= DECLINE =================

function declineCall() {
    document.getElementById("callSetup").style.display = "flex";
    document.getElementById("callState").innerText = "";
    socket.emit("call-declined", { to: incomingFrom });
}

socket.on("call-answered", async ({ answer }) => {
    isCallActive = true;
    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
        console.error("call-answered error:", err);
    }
});

socket.on("ice-candidate", async ({ candidate }) => {
    if (candidate && peer) {
        try {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("ice-candidate error:", err);
        }
    }
});

socket.on("call-declined", () => alert("User declined the call"));

socket.on("user-left", ({ socketId }) => {
    if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
    const video = document.getElementById(socketId);
    if (video) video.remove();
    updateVideoGrid();
});

// ================= CONTROLS =================

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    const btn = document.querySelector("#callControls button:nth-child(1)");
    btn.innerText = isMuted ? "🔇 Unmute" : "🎤 Mute";
}

function toggleCamera() {
    if (!localStream) return;
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach(track => track.enabled = !isCameraOff);
    const btn = document.querySelector("#callControls button:nth-child(2)");
    btn.innerText = isCameraOff ? "📷 Camera On" : "📷 Camera Off";
}

function endCall() {
    if (peer) { peer.close(); peer = null; }
    Object.values(peers).forEach(p => p.close());
    peers = {};
    pendingCandidates = {};
    isCallActive = false;
    const container = document.getElementById("videoContainer");
    container.innerHTML = "";
    container.style = "";
    document.getElementById("subtitleBox").style.display = "none";
    document.getElementById("callTitle").style.display = "block";
    document.getElementById("callControls").style.display = "none";
    document.getElementById("callSetup").style.display = "flex";
    document.getElementById("callState").innerText = "";
}

// ================= RECEIVE TRANSLATION =================

socket.on("receive-translation", ({ text, lang }) => {
    showSubtitle(text, false);
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = lang;
    speech.rate = 0.95;
    speech.pitch = 1;
    window.speechSynthesis.speak(speech);
});

// ================= SIDEBAR TOGGLE =================

document.getElementById("menuToggle").onclick = function () {
    document.getElementById("sidebar").classList.toggle("closed");
};

// ================= PAGE NAVIGATION =================

function showPage(page) {
    const home     = document.getElementById("home");
    const meeting  = document.getElementById("meeting");
    const settings = document.getElementById("settings");
    const main     = document.getElementById("mainApp");

    home.style.display     = "none";
    meeting.style.display  = "none";
    settings.style.display = "none";
    main.style.display     = "flex";

    if (page === "home")     home.style.display     = "flex";
    if (page === "meeting")  meeting.style.display  = "flex";
    if (page === "settings") settings.style.display = "flex";
}

window.showPage = showPage;

// ================= PROFILE =================

document.getElementById("uploadPic").addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
        document.getElementById("profilePic").src = reader.result;
        let u = JSON.parse(localStorage.getItem("user")) || {};
        u.photo = reader.result;
        localStorage.setItem("user", JSON.stringify(u));
    };
    reader.readAsDataURL(file);
});

function saveProfile() {
    let updatedUser = JSON.parse(localStorage.getItem("user")) || {};
    updatedUser.name  = document.getElementById("nameInput").value;
    updatedUser.email = document.getElementById("emailInput").value;
    localStorage.setItem("user", JSON.stringify(updatedUser));
    user = updatedUser;
    const welcome = document.getElementById("welcomeUser");
    if (welcome) welcome.innerText = "Hi, " + updatedUser.name + " 👋";
    alert("Profile saved");
}

function logout() {
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

// ================= MEETING =================

function createMeeting() {
    const name     = document.getElementById("meetingName").value.trim();
    const password = document.getElementById("createPassword").value;
    const suffix   = Math.random().toString(36).substring(2, 7);
    const roomId   = (name ? name.toLowerCase().replace(/\s+/g, "-") + "-" : "room-") + suffix;

    socket.emit("create-room", { roomId, password });

    document.getElementById("resultRoomId").textContent   = roomId;
    document.getElementById("resultPassword").textContent = password || "(none)";
    document.getElementById("createResult").style.display = "flex";

    joinRoomWithPassword(roomId, password);
}

function joinMeeting() {
    const roomId   = document.getElementById("roomInput").value.trim();
    const password = document.getElementById("roomPassword").value;
    if (!roomId) { alert("Enter Room ID"); return; }
    joinRoomWithPassword(roomId, password);
}

function joinRoomWithPassword(roomId, password) {
    socket.emit("join-room", { roomId, password, user: user.email });
}

function copyText(elementId, btn) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "✅ Copied!";
        setTimeout(() => btn.textContent = original, 1800);
    });
}