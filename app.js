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

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// =========================
// DATABASE
// =========================

(async () => {
    try {

        await sequelize.authenticate();

        console.log("Database connected");

    } catch (err) {

        console.log("DB Error:", err.message);
    }
})();

// =========================
// SIGNUP
// =========================

app.post("/signup", async (req, res) => {

    try {

        const {
            name,
            email,
            password
        } = req.body;

        if (!name || !email || !password) {

            return res.status(400).json({
                message: "All fields required"
            });
        }

        const exists =
            await User.findOne({
                where: { email }
            });

        if (exists) {

            return res.status(409).json({
                message: "User exists"
            });
        }

        const user =
            await User.create({
                name,
                email,
                password
            });

        res.status(201).json({
            message: "Signup success",
            name: user.name
        });

    } catch (err) {

        console.log("Signup Error:", err);

        res.status(500).json({
            message: "Server error"
        });
    }
});

// =========================
// LOGIN
// =========================

app.post("/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;

        const user =
            await User.findOne({
                where: { email }
            });

        if (!user) {

            return res.status(404).json({
                message: "User not found"
            });
        }

        if (user.password !== password) {

            return res.status(401).json({
                message: "Wrong password"
            });
        }

        res.json({
            message: "Login success",
            name: user.name
        });

    } catch (err) {

        console.log("Login Error:", err);

        res.status(500).json({
            message: "Server error"
        });
    }
});

// =========================
// TRANSLATE API
// =========================

app.post("/translate", async (req, res) => {

    const {
        text,
        target
    } = req.body;

    try {

        const translated =
            await translate(text, {
                to: target
            });

        res.json({
            translated
        });

    } catch (err) {

        console.log("Translation Error:", err);

        res.status(500).json({
            error: "Translation failed"
        });
    }
});

// =========================
// SOCKET STORAGE
// =========================

let users = {};

let rooms = {};

// =========================
// SOCKET CONNECTION
// =========================

io.on("connection", (socket) => {

    console.log("🔵 Connected:", socket.id);

    // =========================
    // REGISTER USER
    // =========================

    socket.on("register", (email) => {

        if (!email) return;

        users[email] = socket.id;

        socket.email = email;

        console.log("Registered:", email, socket.id);
    });

    // =========================
    // ONE TO ONE CALL
    // =========================

    socket.on("call-user", ({ to, offer }) => {

        const targetSocket = users[to];

        if (!targetSocket) {

            console.log("User not found");

            return;
        }

        io.to(targetSocket).emit("incoming-call", {
            from: socket.id,
            offer
        });

        io.to(socket.id).emit("user-found", {
            socketId: targetSocket
        });
    });

    socket.on("answer-call", ({ to, answer }) => {

        io.to(to).emit("call-answered", {
            answer
        });
    });

    socket.on("ice-candidate", ({ to, candidate }) => {

        io.to(to).emit("ice-candidate", {
            candidate
        });
    });

    socket.on("call-declined", ({ to }) => {

        io.to(to).emit("call-declined");
    });

    // =========================
    // CREATE ROOM
    // =========================

    socket.on("create-room", ({ roomId, password }) => {

        rooms[roomId] = {
            password: password || null,
            users: []
        };

        console.log("Room created:", roomId);
    });

    // =========================
    // JOIN ROOM
    // =========================

    socket.on("join-room", ({ roomId, password, user }) => {

        const room = rooms[roomId];

        if (!room) {

            socket.emit("join-error", "Room does not exist");

            return;
        }

        if (
            room.password &&
            room.password !== password
        ) {

            socket.emit("join-error", "Wrong password");

            return;
        }

        socket.join(roomId);

        socket.roomId = roomId;

        room.users.push(socket.id);

        console.log(user + " joined room:", roomId);

        // notify old users
        socket.to(roomId).emit("user-joined", {
            socketId: socket.id
        });

        // notify new user about old users
        room.users.forEach(id => {

            if (id !== socket.id) {

                socket.emit("user-joined", {
                    socketId: id
                });
            }
        });

        socket.emit("join-success", roomId);
    });

    // =========================
    // ROOM OFFER
    // =========================

    socket.on("room-offer", ({ to, offer }) => {

        io.to(to).emit("room-offer", {
            from: socket.id,
            offer
        });
    });

    // =========================
    // ROOM ANSWER
    // =========================

    socket.on("room-answer", ({ to, answer }) => {

        io.to(to).emit("room-answer", {
            from: socket.id,
            answer
        });
    });

    // =========================
    // ROOM ICE
    // =========================

    socket.on("room-ice", ({ to, candidate }) => {

        io.to(to).emit("room-ice", {
            from: socket.id,
            candidate
        });
    });

    // =========================
    // TRANSLATION DIRECT
    // =========================

    socket.on("send-translation", ({ to, text, lang }) => {

        io.to(to).emit("receive-translation", {
            text,
            lang
        });
    });

    // =========================
    // TRANSLATION ROOM
    // =========================

    socket.on("send-translation-room", ({
        roomId,
        text,
        lang
    }) => {

        socket.to(roomId).emit("receive-translation", {
            text,
            lang
        });
    });

    // =========================
    // DISCONNECT
    // =========================

    socket.on("disconnect", () => {

        console.log("Disconnected:", socket.id);

        // remove user
        for (let email in users) {

            if (users[email] === socket.id) {

                delete users[email];
            }
        }

        // remove from room
        if (
            socket.roomId &&
            rooms[socket.roomId]
        ) {

            rooms[socket.roomId].users =
                rooms[socket.roomId].users.filter(
                    id => id !== socket.id
                );

            socket.to(socket.roomId).emit("user-left", {
                socketId: socket.id
            });

            // delete empty room
            if (
                rooms[socket.roomId].users.length === 0
            ) {

                delete rooms[socket.roomId];
            }
        }
    });
});

// =========================
// START SERVER
// =========================

server.listen(3000, () => {

    console.log("🚀 Server running on port 3000");
});