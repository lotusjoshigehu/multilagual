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
    // Auto-restart if still supposed to be listening
    if (isListening) {
        recognition.start();
    }
};

async function processSentence(text) {
    // ✅ FIXED: was "input" / "output" — now matches HTML ids
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
        // ✅ FIXED: was "output" — now matches HTML id
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

// ================= VIDEO =================

const socket = io("https://multilagual.onrender.com");

let localStream;
let peers = {};
let peer = null;
let targetSocketId = "";

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

    // ✅ FIXED: Wire up the Start Speaking button here after DOM is ready
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

    showPage("home");
};

// ================= CAMERA =================

async function initVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
                echoCancellation: true,   // kills the echo loop
                noiseSuppression: true,   // removes mic hiss/noise
                autoGainControl: true,    // prevents volume spikes
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
    const targetEmail = document.getElementById("targetEmail").value;
    document.getElementById("callState").innerText = "Calling...";
    document.getElementById("callTitle").style.display = "none";
    if (!targetEmail) { alert("Enter target email"); return; }

    document.getElementById("callSetup").style.display = "none";
    const controls = document.getElementById("callControls");
    controls.style.display = "flex";

    peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
            { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
        ]
    });

    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = (event) => addRemoteVideo(event.streams[0], "remoteVideo");
    peer.onicecandidate = (event) => {
        if (event.candidate && targetSocketId) {
            socket.emit("ice-candidate", { to: targetSocketId, candidate: event.candidate });
        }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("call-user", { to: targetEmail, offer });
}

// ================= VIDEO =================

function addRemoteVideo(stream, id) {
    if (document.getElementById(id)) return;
    const video = document.createElement("video");
    video.id = id;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.className = "remote-video";
    document.getElementById("videoContainer").appendChild(video);
    setTimeout(() => {
        video.srcObject = stream;
        video.play().catch(() => {});
    }, 100);
}

// ================= SOCKET EVENTS =================

socket.on("user-found", ({ socketId }) => {
    targetSocketId = socketId;
});

socket.on("room-offer", async ({ from, offer }) => {
    if (peers[from]) return;
    const newPeer = createPeer(from);
    peers[from] = newPeer;
    localStream.getTracks().forEach(track => newPeer.addTrack(track, localStream));
    await newPeer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await newPeer.createAnswer();
    await newPeer.setLocalDescription(answer);
    socket.emit("room-answer", { to: from, answer });
});

socket.on("room-answer", async ({ from, answer }) => {
    if (!peers[from]) return;
    if (peers[from].signalingState !== "have-local-offer") return;
    await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("room-ice", async ({ from, candidate }) => {
    if (peers[from]) await peers[from].addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("incoming-call", ({ from, offer }) => {
    incomingOffer = offer;
    incomingFrom = from;
    document.getElementById("incomingUI").style.display = "block";
});

socket.on("user-joined", async ({ socketId }) => {
    if (peers[socketId]) return;
    const newPeer = createPeer(socketId);
    peers[socketId] = newPeer;
    localStream.getTracks().forEach(track => newPeer.addTrack(track, localStream));
    const offer = await newPeer.createOffer();
    await newPeer.setLocalDescription(offer);
    socket.emit("room-offer", { to: socketId, offer });
});

// ================= ACCEPT =================

async function acceptCall() {
    isCallActive = true;
    document.getElementById("incomingUI").style.display = "none";
    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    document.getElementById("callSetup").style.display = "none";
    document.getElementById("callTitle").style.display = "none";

    const controls = document.getElementById("callControls");
    controls.style.display = "flex";

    targetSocketId = incomingFrom;

    peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
            { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
        ]
    });

    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = (event) => addRemoteVideo(event.streams[0], "remoteVideo");
    peer.onicecandidate = (event) => {
        if (event.candidate) socket.emit("ice-candidate", { to: incomingFrom, candidate: event.candidate });
    };

    await peer.setRemoteDescription(new RTCSessionDescription(incomingOffer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("answer-call", { to: incomingFrom, answer });
}

// ================= DECLINE =================

function declineCall() {
    document.getElementById("incomingUI").style.display = "none";
    const setup = document.getElementById("callSetup");
    setup.style.display = "flex";
    document.getElementById("callState").innerText = "";
    socket.emit("call-declined", { to: incomingFrom });
}

function createPeer(socketId) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peer.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream.id === localStream.id) return;
        addRemoteVideo(stream, socketId);
    };
    peer.onicecandidate = (event) => {
        if (event.candidate) socket.emit("room-ice", { to: socketId, candidate: event.candidate });
    };
    return peer;
}

socket.on("call-answered", async ({ answer }) => {
    isCallActive = true;
    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async ({ candidate }) => {
    if (candidate && peer) await peer.addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("call-declined", () => alert("User declined the call"));

socket.on("user-left", ({ socketId }) => {
    if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
    const video = document.getElementById(socketId);
    if (video) video.remove();
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
    isCallActive = false;
    document.getElementById("videoContainer").innerHTML = "";
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
    const home = document.getElementById("home");
    const meeting = document.getElementById("meeting");
    const settings = document.getElementById("settings");
    const main = document.getElementById("mainApp");

    home.style.display = "none";
    meeting.style.display = "none";
    settings.style.display = "none";
    main.style.display = "flex";

    if (page === "home")     home.style.display = "flex";
    if (page === "meeting")  meeting.style.display = "flex";
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

// ================= MEETING =================

function createMeeting() {
    const name     = document.getElementById("meetingName").value.trim();
    const password = document.getElementById("createPassword").value;

    // Generate a readable room ID using meeting name + random suffix
    const suffix = Math.random().toString(36).substring(2, 7);
    const roomId = (name ? name.toLowerCase().replace(/\s+/g, "-") + "-" : "room-") + suffix;

    socket.emit("create-room", { roomId, password });

    // Show the result box
    document.getElementById("resultRoomId").textContent   = roomId;
    document.getElementById("resultPassword").textContent = password || "(none)";
    document.getElementById("createResult").style.display = "flex";

    // Auto-join the created room
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

// Copy text to clipboard and briefly change button label
function copyText(elementId, btn) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "✅ Copied!";
        setTimeout(() => btn.textContent = original, 1800);
    });
}