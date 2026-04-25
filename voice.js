// ================= VOICE =================

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();

recognition.continuous = true;
recognition.interimResults = false;
recognition.maxAlternatives = 1;

let bufferText = "";
let timeout = null;
let isCallActive = false;
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
        const res = await fetch("http://localhost:3000/translate", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ text, target })
        });

        const data = await res.json();

        document.getElementById("output").innerText = data.translated;

        if (targetSocketId) {
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

const socket = io("http://localhost:3000");

let localStream;
let peer;
let targetSocketId = "";

// 🔥 NEW STATES
let isMuted = false;
let isCameraOff = false;
let incomingOffer = null;
let incomingFrom = null;

// Debug
socket.on("connect", () => {
    console.log("Connected:", socket.id);
});

// ================= AUTO REGISTER =================

window.onload = function () {

    // ===== REGISTER =====
    let user = JSON.parse(localStorage.getItem("user"));
    let email = localStorage.getItem("userEmail");

    if (!email) {
        email = "user_" + Math.floor(Math.random() * 10000) + "@app.com";
        localStorage.setItem("userEmail", email);
    }

    document.getElementById("myEmail").value = email;
    socket.emit("register", email);

    console.log("Registered as:", email);

    // ===== ✅ PROFILE LOAD (PUT HERE) =====
    if (user) {
        document.getElementById("nameInput").value = user.name || "";
        document.getElementById("emailInput").value = user.email || "";

        const welcome = document.getElementById("welcomeUser");
        if (welcome) {
            welcome.innerText = "Hi, " + (user.name || "User") + " 👋";
        }

        if (user.photo) {
            document.getElementById("profilePic").src = user.photo;
        }
    }

    // ===== DEFAULT PAGE =====
    showPage("home");
};


// ================= CAMERA =================

async function initVideo() {
    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    });

    document.getElementById("localVideo").srcObject = localStream;
}
initVideo();


// ================= CALL =================

function registerUser() {
    const email = document.getElementById("myEmail").value;

    if (!email) {
        alert("Enter your email");
        return;
    }

    socket.emit("register", email);
}

async function startCall() {
    registerUser();

    const targetEmail = document.getElementById("targetEmail").value;
    document.getElementById("callState").innerText = "Calling...";

    if (!targetEmail) {
        alert("Enter target email");
        return;
    }

    // 🔥 HIDE INPUT UI
    // hide only inputs + button
   document.getElementById("myEmail").style.visibility = "hidden";
   document.getElementById("targetEmail").style.visibility = "hidden";
   document.querySelector("#callSetup button").style.visibility = "hidden";
    // 🔥 SHOW CONTROLS
    document.getElementById("callControls").style.display = "block";

    peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
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


// ================= SOCKET EVENTS =================

// Get socket ID
socket.on("user-found", ({ socketId }) => {
    targetSocketId = socketId;
    console.log("Target socket:", socketId);
});

// ================= INCOMING CALL (UPDATED) =================

socket.on("incoming-call", ({ from, offer }) => {

    console.log("Incoming call");

    incomingOffer = offer;
    incomingFrom = from;

    document.getElementById("incomingUI").style.display = "block";
});

// ================= ACCEPT =================

async function acceptCall() {
    isCallActive = true;

    document.getElementById("incomingUI").style.display = "none";

    document.getElementById("subtitleBox").style.display = "block";
    document.getElementById("callState").innerText = "Connected";
    

    // 🔥 HIDE INPUT

    // 🔥 SHOW CONTROLS
    document.getElementById("callControls").style.display = "block";


    targetSocketId = incomingFrom;

    peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
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

    document.getElementById("callSetup").style.display = "block";
    document.getElementById("callState").innerText = "";

    socket.emit("call-declined", {
        to: incomingFrom
    });
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

// ================= CONTROLS =================

// 🎤 Mute
function toggleMute() {
    isMuted = !isMuted;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });

    const btn = document.querySelector("#callControls button:nth-child(1)");
    btn.innerText = isMuted ? "🔇 Unmute" : "🎤 Mute";
}

// 📷 Camera
function toggleCamera() {
    isCameraOff = !isCameraOff;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = !isCameraOff;
    });

    const btn = document.querySelector("#callControls button:nth-child(2)");
    btn.innerText = isCameraOff ? "📷 Camera On" : "📷 Camera Off";
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

    // 🔥 HIDE CONTROLS
    document.getElementById("callControls").style.display = "block";

    // 🔥 SHOW INPUT AGAIN
    document.getElementById("callSetup").style.display = "block";
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

    bar.classList.remove("hidden");

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

    if (page === "home") {
        home.style.display = "flex";
        if (local) local.style.display = "none";
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
    let user = JSON.parse(localStorage.getItem("user")) || {};

    user.name = document.getElementById("nameInput").value;

    localStorage.setItem("user", JSON.stringify(user));

    alert("Profile Updated ✅");

    // update greeting instantly
    const welcome = document.getElementById("welcomeUser");
    if (welcome) {
        welcome.innerText = "Hi, " + user.name + " 👋";
    }
}

function logout() {
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

