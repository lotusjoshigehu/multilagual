const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const translate = require("translate-google");
const sequelize = require("./connection/dbconnection");
const cors = require("cors");

require("./models/users");
const User = require("./models/users");

const app = express();
const server = http.createServer(app);

// ================= SOCKET =================
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ================= DB =================
(async () => {
    try {
        await sequelize.authenticate();
        console.log("✅ Database connected");
    } catch (err) {
        console.log("❌ DB Error:", err.message);
    }
})();

// ================= AUTH =================
app.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: "All fields required" });
        }

        const exists = await User.findOne({ where: { email } });

        if (exists) {
            return res.status(409).json({ message: "User exists" });
        }

        const user = await User.create({ name, email, password });

        res.status(201).json({
            message: "Signup success",
            name: user.name
        });

    } catch (err) {
        console.log("Signup Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ where: { email } });

        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.password !== password) {
            return res.status(401).json({ message: "Wrong password" });
        }

        res.json({
            message: "Login success",
            name: user.name
        });

    } catch (err) {
        console.log("Login Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================= TRANSLATE =================
app.post("/translate", async (req, res) => {
    const { text, target } = req.body;

    try {
        const translated = await translate(text, { to: target });
        res.json({ translated });
    } catch (err) {
        console.log("Translation error:", err);
        res.status(500).json({ error: "Translation failed" });
    }
});

// ================= SOCKET LOGIC =================
let users = {}; // email -> socketId

io.on("connection", (socket) => {

    console.log("🔵 User connected:", socket.id);

    // ================= REGISTER =================
    socket.on("register", (email) => {
        if (!email) return;

        users[email] = socket.id;
        console.log("✅ Registered:", email, "=>", socket.id);
    });

    // ================= CALL (1-to-1) =================
    socket.on("call-user", ({ to, offer }) => {

        const targetSocket = users[to];

        if (targetSocket) {
            io.to(targetSocket).emit("incoming-call", {
                from: socket.id,
                offer
            });

            socket.emit("user-found", { socketId: targetSocket });
        }
    });

    socket.on("answer-call", ({ to, answer }) => {
        io.to(to).emit("call-answered", { answer });
    });

    socket.on("ice-candidate", ({ to, candidate }) => {
        io.to(to).emit("ice-candidate", { candidate });
    });

    // ================= 1-to-1 TRANSLATION =================
    socket.on("send-translation", ({ to, text, lang }) => {
        io.to(to).emit("receive-translation", { text, lang });
    });

    // ================= ROOM JOIN =================
    socket.on("join-room", ({ roomId, user }) => {
        socket.join(roomId);

        console.log(`${user} joined room: ${roomId}`);

        socket.to(roomId).emit("user-joined", {
            socketId: socket.id
        });
    });

    // ================= ROOM TRANSLATION =================
    socket.on("send-translation-room", ({ roomId, text, lang }) => {
        socket.to(roomId).emit("receive-translation", { text, lang });
    });

    // ================= ROOM WEBRTC =================
    socket.on("room-offer", ({ to, offer }) => {
        io.to(to).emit("room-offer", {
            from: socket.id,
            offer
        });
    });

    socket.on("room-answer", ({ to, answer }) => {
        io.to(to).emit("room-answer", {
            from: socket.id,
            answer
        });
    });

    socket.on("room-ice", ({ to, candidate }) => {
        io.to(to).emit("room-ice", {
            from: socket.id,
            candidate
        });
    });

    // ================= DISCONNECT =================
    socket.on("disconnect", () => {

        console.log("🔴 Disconnected:", socket.id);

        // remove user
        for (let email in users) {
            if (users[email] === socket.id) {
                delete users[email];
            }
        }

        // notify room users
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.to(room).emit("user-left", {
                    socketId: socket.id
                });
            }
        });
    });
});

// ================= START =================
server.listen(3000, () => {
    console.log("Server running on port 3000");
});