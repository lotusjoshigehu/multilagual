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

const ICE_SERVERS = {
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
};

function showSubtitle(text, isLocal = true) {
    if (!isCallActive) return;

    const box = document.getElementById("subtitleBox");

    box.innerHTML = `
        <div style="color:${isLocal ? "cyan" : "yellow"};font-size:18px;">
            ${isLocal ? "You" : "Other"}: ${text}
        </div>
    `;
}

recognition.onresult = function (event) {
    let text =
        event.results[event.results.length - 1][0].transcript.trim();

    if (!text) return;

    bufferText += " " + text;

    if (timeout) clearTimeout(timeout);

    timeout = setTimeout(() => {
        processSentence(bufferText.trim());
        bufferText = "";
    }, 1200);
};

recognition.onerror = function (event) {
    console.error("Speech recognition error:", event.error);

    if (event.error === "not-allowed") {
        alert("Microphone permission denied");
    }
};

recognition.onend = function () {
    if (isListening) {
        recognition.start();
    }
};

async function processSentence(text) {
    document.getElementById("inputText").innerText = text;

    showSubtitle(text, true);

    const target = document.getElementById("outputLang").value;

    try {
        const res = await fetch(
            "https://multilagual.onrender.com/translate",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    text,
                    target
                })
            }
        );

        const data = await res.json();

        document.getElementById("outputText").innerText =
            data.translated;

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
    }
});

window.onload = function () {
    user = JSON.parse(localStorage.getItem("user"));

    if (!user || !user.email) {
        window.location.href = "login.html";
        return;
    }

    document.getElementById("myEmail") &&
        (document.getElementById("myEmail").value = user.email);

    document.getElementById("nameInput").value =
        user.name || "";

    document.getElementById("emailInput").value =
        user.email || "";

    const welcome =
        document.getElementById("welcomeUser");

    if (welcome) {
        welcome.innerText =
            "Hi, " + (user.name || "User");
    }

    if (user.photo) {
        document.getElementById("profilePic").src =
            user.photo;
    }

    const btn =
        document.getElementById("startSpeaking");

    btn.addEventListener("click", () => {
        if (!isListening) {
            isListening = true;

            const inputLang =
                document.getElementById("inputLang").value;

            recognition.lang = inputLang || "en-US";

            recognition.start();

            btn.textContent = "Stop Speaking";

            btn.style.background =
                "linear-gradient(135deg, #ef4444, #b91c1c)";
        } else {
            isListening = false;

            recognition.stop();

            btn.textContent = "Start Speaking";

            btn.style.background = "";
        }
    });

    showPage("home");
};

async function initVideo() {
    try {
        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });

        const localVideo =
            document.getElementById("localVideo");

        localVideo.srcObject = localStream;

        localVideo.muted = true;

        await localVideo.play();

    } catch (err) {
        console.error(err);
        alert("Allow camera and microphone");
    }
}

initVideo();

function addRemoteVideo(stream, id) {

    let video = document.getElementById(id);

    if (!video) {

        video = document.createElement("video");

        video.id = id;

        video.autoplay = true;

        video.playsInline = true;

        video.className = "remote-video";

        document
            .getElementById("videoContainer")
            .appendChild(video);
    }

    video.srcObject = stream;

    video.onloadedmetadata = () => {
        video.play().catch(() => {});
    };
}

function createPeer(socketId) {

    const newPeer = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach(track => {
        newPeer.addTrack(track, localStream);
    });

    newPeer.ontrack = (event) => {

        const remoteStream = event.streams[0];

        if (!remoteStream) return;

        addRemoteVideo(remoteStream, socketId);
    };

    newPeer.onicecandidate = (event) => {

        if (event.candidate) {

            socket.emit("room-ice", {
                to: socketId,
                candidate: event.candidate
            });

            socket.emit("ice-candidate", {
                to: socketId,
                candidate: event.candidate
            });
        }
    };

    newPeer.onconnectionstatechange = () => {

        if (
            newPeer.connectionState === "disconnected" ||
            newPeer.connectionState === "failed" ||
            newPeer.connectionState === "closed"
        ) {

            const video =
                document.getElementById(socketId);

            if (video) {
                video.remove();
            }

            if (peers[socketId]) {
                peers[socketId].close();
                delete peers[socketId];
            }
        }
    };

    return newPeer;
}

async function startCall() {

    if (!localStream) {
        alert("Camera not ready");
        return;
    }

    const targetEmail =
        document.getElementById("targetEmail").value;

    if (!targetEmail) {
        alert("Enter target email");
        return;
    }

    document.getElementById("callState").innerText =
        "Calling...";

    document.getElementById("callTitle").style.display =
        "none";

    document.getElementById("callSetup").style.display =
        "none";

    document.getElementById("callControls").style.display =
        "flex";

    peer = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    peer.ontrack = (event) => {
        addRemoteVideo(
            event.streams[0],
            "remoteVideo"
        );
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
}

socket.on("user-found", ({ socketId }) => {
    targetSocketId = socketId;
});

socket.on("incoming-call", ({ from, offer }) => {

    incomingOffer = offer;

    incomingFrom = from;

    document.getElementById("incomingUI").style.display =
        "block";
});

async function acceptCall() {

    isCallActive = true;

    targetSocketId = incomingFrom;

    document.getElementById("incomingUI").style.display =
        "none";

    document.getElementById("subtitleBox").style.display =
        "block";

    document.getElementById("callState").innerText =
        "Connected";

    document.getElementById("callSetup").style.display =
        "none";

    document.getElementById("callControls").style.display =
        "flex";

    peer = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    peer.ontrack = (event) => {
        addRemoteVideo(
            event.streams[0],
            "remoteVideo"
        );
    };

    peer.onicecandidate = (event) => {

        if (event.candidate) {

            socket.emit("ice-candidate", {
                to: incomingFrom,
                candidate: event.candidate
            });
        }
    };

    await peer.setRemoteDescription(
        new RTCSessionDescription(incomingOffer)
    );

    const answer = await peer.createAnswer();

    await peer.setLocalDescription(answer);

    socket.emit("answer-call", {
        to: incomingFrom,
        answer
    });
}

function declineCall() {

    document.getElementById("incomingUI").style.display =
        "none";

    document.getElementById("callSetup").style.display =
        "flex";

    socket.emit("call-declined", {
        to: incomingFrom
    });
}

socket.on("call-answered", async ({ answer }) => {

    isCallActive = true;

    document.getElementById("subtitleBox").style.display =
        "block";

    document.getElementById("callState").innerText =
        "Connected";

    await peer.setRemoteDescription(
        new RTCSessionDescription(answer)
    );
});

socket.on("ice-candidate", async ({ candidate }) => {

    try {

        if (candidate && peer) {

            await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        }

    } catch (err) {
        console.error(err);
    }
});

socket.on("join-success", (roomId) => {

    currentRoom = roomId;

    isCallActive = true;

    document.getElementById("meetingInfo").innerText =
        "Joined: " + roomId;

    document.getElementById("subtitleBox").style.display =
        "block";
});

socket.on("user-joined", async ({ socketId }) => {

    if (peers[socketId]) return;

    const newPeer = createPeer(socketId);

    peers[socketId] = newPeer;

    const offer = await newPeer.createOffer();

    await newPeer.setLocalDescription(offer);

    socket.emit("room-offer", {
        to: socketId,
        offer
    });
});

socket.on("room-offer", async ({ from, offer }) => {

    if (peers[from]) return;

    const newPeer = createPeer(from);

    peers[from] = newPeer;

    await newPeer.setRemoteDescription(
        new RTCSessionDescription(offer)
    );

    const answer = await newPeer.createAnswer();

    await newPeer.setLocalDescription(answer);

    socket.emit("room-answer", {
        to: from,
        answer
    });
});

socket.on("room-answer", async ({ from, answer }) => {

    if (!peers[from]) return;

    await peers[from].setRemoteDescription(
        new RTCSessionDescription(answer)
    );
});

socket.on("room-ice", async ({ from, candidate }) => {

    try {

        if (peers[from]) {

            await peers[from].addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        }

    } catch (err) {
        console.error(err);
    }
});

socket.on("user-left", ({ socketId }) => {

    if (peers[socketId]) {

        peers[socketId].close();

        delete peers[socketId];
    }

    const video =
        document.getElementById(socketId);

    if (video) {
        video.remove();
    }
});

function toggleMute() {

    if (!localStream) return;

    isMuted = !isMuted;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });

    const btn =
        document.querySelector(
            "#callControls button:nth-child(1)"
        );

    btn.innerText =
        isMuted ? "Unmute" : "Mute";
}

function toggleCamera() {

    if (!localStream) return;

    isCameraOff = !isCameraOff;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = !isCameraOff;
    });

    const btn =
        document.querySelector(
            "#callControls button:nth-child(2)"
        );

    btn.innerText =
        isCameraOff
            ? "Camera On"
            : "Camera Off";
}

function endCall() {

    isCallActive = false;

    if (peer) {
        peer.close();
        peer = null;
    }

    Object.values(peers).forEach(p => p.close());

    peers = {};

    document
        .querySelectorAll(".remote-video")
        .forEach(video => video.remove());

    document.getElementById("subtitleBox").style.display =
        "none";

    document.getElementById("callTitle").style.display =
        "block";

    document.getElementById("callControls").style.display =
        "none";

    document.getElementById("callSetup").style.display =
        "flex";

    document.getElementById("callState").innerText = "";
}

socket.on("receive-translation", ({ text, lang }) => {

    showSubtitle(text, false);

    window.speechSynthesis.cancel();

    const speech =
        new SpeechSynthesisUtterance(text);

    speech.lang = lang;

    speech.rate = 0.95;

    speech.pitch = 1;

    window.speechSynthesis.speak(speech);
});

document.getElementById("menuToggle").onclick =
    function () {

        document
            .getElementById("sidebar")
            .classList.toggle("closed");
    };

function showPage(page) {

    const home =
        document.getElementById("home");

    const meeting =
        document.getElementById("meeting");

    const settings =
        document.getElementById("settings");

    const main =
        document.getElementById("mainApp");

    home.style.display = "none";

    meeting.style.display = "none";

    settings.style.display = "none";

    main.style.display = "flex";

    if (page === "home") {
        home.style.display = "flex";
    }

    if (page === "meeting") {
        meeting.style.display = "flex";
    }

    if (page === "settings") {
        settings.style.display = "flex";
    }
}

window.showPage = showPage;

document
    .getElementById("uploadPic")
    .addEventListener("change", function () {

        const file = this.files[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = function () {

            document.getElementById(
                "profilePic"
            ).src = reader.result;

            let u =
                JSON.parse(
                    localStorage.getItem("user")
                ) || {};

            u.photo = reader.result;

            localStorage.setItem(
                "user",
                JSON.stringify(u)
            );
        };

        reader.readAsDataURL(file);
    });

function saveProfile() {

    let updatedUser =
        JSON.parse(localStorage.getItem("user")) || {};

    updatedUser.name =
        document.getElementById("nameInput").value;

    updatedUser.email =
        document.getElementById("emailInput").value;

    localStorage.setItem(
        "user",
        JSON.stringify(updatedUser)
    );

    user = updatedUser;

    const welcome =
        document.getElementById("welcomeUser");

    if (welcome) {
        welcome.innerText =
            "Hi, " + updatedUser.name;
    }

    alert("Profile saved");
}

function logout() {

    localStorage.removeItem("user");

    window.location.href = "login.html";
}

function createMeeting() {

    const name =
        document.getElementById("meetingName")
            .value
            .trim();

    const password =
        document.getElementById("createPassword")
            .value;

    const suffix =
        Math.random()
            .toString(36)
            .substring(2, 7);

    const roomId =
        (name
            ? name
                  .toLowerCase()
                  .replace(/\s+/g, "-") + "-"
            : "room-") + suffix;

    socket.emit("create-room", {
        roomId,
        password
    });

    document.getElementById(
        "resultRoomId"
    ).textContent = roomId;

    document.getElementById(
        "resultPassword"
    ).textContent = password || "(none)";

    document.getElementById(
        "createResult"
    ).style.display = "flex";

    joinRoomWithPassword(roomId, password);
}

function joinMeeting() {

    const roomId =
        document.getElementById("roomInput")
            .value
            .trim();

    const password =
        document.getElementById("roomPassword")
            .value;

    if (!roomId) {
        alert("Enter Room ID");
        return;
    }

    joinRoomWithPassword(roomId, password);
}

function joinRoomWithPassword(roomId, password) {

    socket.emit("join-room", {
        roomId,
        password,
        user: user.email
    });
}

function copyText(elementId, btn) {

    const text =
        document.getElementById(elementId)
            .textContent;

    navigator.clipboard
        .writeText(text)
        .then(() => {

            const original =
                btn.textContent;

            btn.textContent = "Copied!";

            setTimeout(() => {
                btn.textContent = original;
            }, 1800);
        });
}