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

function start() {
    const inputLang = document.getElementById("inputLang").value;
    recognition.lang = inputLang || "en-US";
    recognition.start();
}

// Subtitle
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

async function processSentence(text) {

    document.getElementById("input").innerText = text;
    showSubtitle(text, true);

    const target = document.getElementById("outputLang").value;

    try {
        const res = await fetch("https://multilagual.onrender.com/translate", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ text, target })
        });

        const data = await res.json();

        document.getElementById("output").innerText = data.translated;

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
let peers={}
let peer=null
let targetSocketId = "";

// 🔥 NEW STATES
let isMuted = false;
let isCameraOff = false;
let incomingOffer = null;
let incomingFrom = null;

// Debug
socket.on("connect", () => {
    if (user && user.email) {
        socket.emit("register", user.email);
        console.log("Registered:", user.email);
    }
});

// ================= AUTO REGISTER =================


window.onload = function () {

    // ===== GET USER FROM LOCAL STORAGE =====
    

    if (!user || !user.email) {
        window.location.href = "login.html";
        return;
    }

    // ===== SET EMAIL IN INPUT =====
    document.getElementById("myEmail").value = user.email;

    // ===== REGISTER SOCKET USER =====


    // ===== LOAD PROFILE =====
    document.getElementById("nameInput").value = user.name || "";
    document.getElementById("emailInput").value = user.email || "";

    const welcome = document.getElementById("welcomeUser");
    if (welcome) {
        welcome.innerText = "Hi, " + (user.name || "User") + " 👋";
    }

    if (user.photo) {
        document.getElementById("profilePic").src = user.photo;
    }

    // ===== DEFAULT PAGE =====
    showPage("home");
};


// ================= CAMERA =================

async function initVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        const video = document.getElementById("localVideo");
        video.srcObject = localStream;
        video.muted = true;
        await video.play();

        console.log("Camera working");
    } catch (err) {
        console.error(err);
        alert("Allow camera permission");
    }
}
initVideo();


// ================= CALL =================


async function startCall() {
    
    if (!localStream) {
    alert("Camera not ready");
    return;
}

    const targetEmail = document.getElementById("targetEmail").value;
    document.getElementById("callState").innerText = "Calling...";
    document.getElementById("callTitle").style.display = "none";

    if (!targetEmail) {
        alert("Enter target email");
        return;
    }

    // 🔥 HIDE INPUT UI
    // hide only inputs + button
   document.getElementById("callSetup").style.display = "none";
    // 🔥 SHOW CONTROLS
    const controls = document.getElementById("callControls");
    controls.style.display = "flex";
    controls.style.justifyContent = "center";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";

    peer = new RTCPeerConnection({
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },

        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
});

    localStream.getTracks().forEach(track =>
        peer.addTrack(track, localStream)
    );

    peer.ontrack = (event) => {
        document.getElementById("remoteVideo").srcObject = event.streams[0];
    };

    peer.onicecandidate = (event) => {
        if (event.candidate && targetSocketId) {
            socket.emit("ice-candidate", {
                to: targetSocketId,
                candidate: event.candidate
            });
        }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("call-user", {
        to: targetEmail,
        offer
    });

    console.log("Calling:", targetEmail);
}

function addRemoteVideo(stream, id) {

    let video = document.getElementById(id);

    if (!video) {
        video = document.createElement("video");
        video.id = id;
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = "200px";

        document.getElementById("videoContainer").appendChild(video);
    }

    video.srcObject = stream;
}


// ================= SOCKET EVENTS =================

// Get socket ID
socket.on("user-found", ({ socketId }) => {
    targetSocketId = socketId;
    console.log("Target socket:", socketId);
});

socket.on("room-offer", async ({ from, offer }) => {

   const newPeer = createPeer(from);
   peers[from] = newPeer;

   localStream.getTracks().forEach(track => {
       newPeer.addTrack(track, localStream);
   });

   await newPeer.setRemoteDescription(new RTCSessionDescription(offer));

   const answer = await newPeer.createAnswer();
   await newPeer.setLocalDescription(answer);

   socket.emit("room-answer", {
      to: from,
      answer
    });
});

socket.on("room-answer", async ({ from, answer }) => {
    if (!peers[from]) return;
await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("room-ice", async ({ from, candidate }) => {
    if (peers[from]) {
        await peers[from].addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// ================= INCOMING CALL (UPDATED) =================

socket.on("incoming-call", ({ from, offer }) => {

    console.log("Incoming call");

    incomingOffer = offer;
    incomingFrom = from;

    document.getElementById("incomingUI").style.display = "block";
});

socket.on("user-joined", async ({ socketId }) => {

    console.log("New user joined:", socketId);

    const newPeer = createPeer(socketId);

    peers[socketId] = newPeer;

    localStream.getTracks().forEach(track => {
        newPeer.addTrack(track, localStream);
    });

    const offer = await newPeer.createOffer();
    await newPeer.setLocalDescription(offer);

    socket.emit("room-offer", {
        to: socketId,
        offer
    });
});




// ================= ACCEPT =================

async function acceptCall() {
    isCallActive = true;

    document.getElementById("incomingUI").style.display = "none";

    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    document.getElementById("callSetup").style.display = "none";
    document.getElementById("callTitle").style.display = "none";
    

    // 🔥 HIDE INPUT

    // 🔥 SHOW CONTROLS
    const controls = document.getElementById("callControls");
    controls.style.display = "flex";
    controls.style.justifyContent = "center";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";


    targetSocketId = incomingFrom;

    peer = new RTCPeerConnection({
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },

        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
});

    localStream.getTracks().forEach(track =>
        peer.addTrack(track, localStream)
    );

    peer.ontrack = (event) => {
        document.getElementById("remoteVideo").srcObject = event.streams[0];
    };

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", {
                to: incomingFrom,
                candidate: event.candidate
            });
        }
    };

    await peer.setRemoteDescription(new RTCSessionDescription(incomingOffer));

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit("answer-call", {
        to: incomingFrom,
        answer
    });
}

// ================= DECLINE =================

function declineCall() {
    document.getElementById("incomingUI").style.display = "none";

    const setup = document.getElementById("callSetup");
    setup.style.display = "flex";
    setup.style.flexDirection = "column";
    setup.style.alignItems = "center";
    document.getElementById("callState").innerText = "";

    socket.emit("call-declined", {
        to: incomingFrom
    });
}


function createPeer(socketId) {

    const peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    peer.ontrack = (event) => {
        addRemoteVideo(event.streams[0], socketId);
    };

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("room-ice", {
                to: socketId,
                candidate: event.candidate
            });
        }
    };

    return peer;
}
// ================= CALL ANSWERED =================

socket.on("call-answered", async ({ answer }) => {
    isCallActive = true;
    console.log("Call answered");
    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
});

// ================= ICE =================

socket.on("ice-candidate", async ({ candidate }) => {
    if (candidate && peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// ================= DECLINE RECEIVED =================

socket.on("call-declined", () => {
    alert("User declined the call");
});

socket.on("user-left", ({ socketId }) => {

    console.log("User left:", socketId);

    if (peers[socketId]) {
        peers[socketId].close();
        delete peers[socketId];
    }

    const video = document.getElementById(socketId);
    if (video) video.remove();
});

// ================= CONTROLS =================

// 🎤 Mute
function toggleMute() {
    if (!localStream) return;

    isMuted = !isMuted;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });

    // 🔥 UPDATE BUTTON TEXT
    const btn = document.querySelector("#callControls button:nth-child(1)");
    btn.innerText = isMuted ? "🔇 Unmute" : "🎤 Mute";
}

// 📷 Camera
function toggleCamera() {
    if (!localStream) return;

    isCameraOff = !isCameraOff;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = !isCameraOff;
    });
}
// 🔴 End Call
function endCall() {

    if (peer) {
        peer.close();
        peer = null;
    }
    
    isCallActive = false;
    document.getElementById("remoteVideo").srcObject = null;

    document.getElementById("subtitleBox").style.display = "none";
    document.getElementById("callTitle").style.display = "block";

    // 🔥 HIDE CONTROLS
    document.getElementById("callControls").style.display = "none";

    // 🔥 SHOW INPUT AGAIN
    document.getElementById("callSetup").style.display = "flex";
    document.getElementById("callState").innerText = "";
}


// ================= RECEIVE TRANSLATION =================

socket.on("receive-translation", ({ text, lang }) => {

    console.log("Received:", text);

    showSubtitle(text, false);

    window.speechSynthesis.cancel();

    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = lang;
    speech.rate = 0.95;
    speech.pitch = 1;

    window.speechSynthesis.speak(speech);
});

let hideTimer;

// Show controls when mouse moves
document.addEventListener("mousemove", () => {
    const bar = document.getElementById("controlBar");
    if (!bar) return;

    clearTimeout(hideTimer);

    // hide after 3 seconds
    hideTimer = setTimeout(() => {
        bar.classList.add("hidden");
    }, 3000);
});


const toggleBtn = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const main = document.querySelector(".main-container");

toggleBtn.onclick = () => {
    sidebar.classList.toggle("closed");
    main.classList.toggle("full");
};


function showPage(page) {
    const meeting = document.getElementById("meeting");

    const home = document.getElementById("home");
    const left = document.getElementById("translatorLeft");
    const right = document.getElementById("translatorRight");
    const settings = document.getElementById("settings");
    const local = document.getElementById("localVideo");

    // RESET ALL
    home.style.display = "none";
    left.style.display = "none";
    right.style.display = "none";
    settings.style.display = "none";
    meeting.style.display = "none";

    if (page === "home") {
        home.style.display = "flex";
        if (local) local.style.display = "none";
    }

    if (page === "meeting") {
    meeting.style.display = "flex";
}

    if (page === "translator") {
        left.style.display = "block";
        right.style.display = "block";
        if (local) local.style.display = "block";
    }

    if (page === "settings") {
        settings.style.display = "flex";
        if (local) local.style.display = "none";
    }
}

document.getElementById("uploadPic").addEventListener("change", function () {
    const file = this.files[0];
    const reader = new FileReader();

    reader.onload = function () {
        document.getElementById("profilePic").src = reader.result;

        let user = JSON.parse(localStorage.getItem("user")) || {};
        user.photo = reader.result;

        localStorage.setItem("user", JSON.stringify(user));
    };

    if (file) reader.readAsDataURL(file);
});


function saveProfile() {
    let updatedUser = JSON.parse(localStorage.getItem("user")) || {};

    updatedUser.name = document.getElementById("nameInput").value;
    updatedUser.email = document.getElementById("emailInput").value;

    localStorage.setItem("user", JSON.stringify(updatedUser));

    // 🔥 UPDATE GLOBAL USER
    user = updatedUser;

    // 🔥 UPDATE UI
    const welcome = document.getElementById("welcomeUser");
    if (welcome) {
        welcome.innerText = "Hi, " + updatedUser.name + " 👋";
    }

    alert("Profile saved ");
}

function logout() {
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

function joinRoom(roomId) {
    isCallActive = true;
    document.getElementById("subtitleBox").style.display = "block";
    if (!roomId) return;

    currentRoom = roomId;

    socket.emit("join-room", {
        roomId: roomId,
        user: user.email
    });

    console.log("Joined room:", roomId);
}

function createMeeting() {

    const roomId = "room-" + Math.random().toString(36).substring(2, 8);

    document.getElementById("meetingInfo").innerText =
        "Room ID: " + roomId;

    // auto join
    joinRoom(roomId);
}

