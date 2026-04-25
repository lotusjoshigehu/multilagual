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

// ✅ SOCKET CONFIG (CORS FIXED)
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
sequelize.sync()
.then(() => console.log("Database synced"))
.catch(err => console.log(err));


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
            name: user.name   // 🔥 IMPORTANT (frontend needs this)
        });

    } catch (err) {
        console.log("Signup Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.password !== password)
        return res.status(401).json({ message: "Wrong password" });

    res.json({ message: "Login success" });
});


// ================= TRANSLATE =================
app.post("/translate", async (req, res) => {
    const { text, target } = req.body;

    try {
        // 🔥 auto-detect handled by library internally
        const translated = await translate(text, { to: target });
        res.json({ translated });
    } catch (err) {
        console.log("Translation error:", err);
        res.status(500).json({ error: "Translation failed" });
    }
});


// ================= SOCKET =================
let users = {}; // email -> socketId

io.on("connection", (socket) => {

    console.log("🔵 User connected:", socket.id);

    // ================= REGISTER =================
    socket.on("register", (email) => {
        if (!email) return;

        users[email] = socket.id;
        console.log("✅ Registered:", email, "=>", socket.id);
    });

    // ================= CALL =================
    socket.on("call-user", ({ to, offer }) => {

        const targetSocket = users[to];

        console.log("📞 Calling:", to, "Socket:", targetSocket);

        if (targetSocket) {
            // send call to receiver
            io.to(targetSocket).emit("incoming-call", {
                from: socket.id,
                offer
            });

            // 🔥 send socketId back to caller (IMPORTANT)
            socket.emit("user-found", { socketId: targetSocket });

        } else {
            console.log("❌ User not online:", to);
        }
    });

    // ================= ANSWER =================
    socket.on("answer-call", ({ to, answer }) => {
        console.log("✅ Call answered");
        io.to(to).emit("call-answered", { answer });
    });

    // ================= ICE =================
    socket.on("ice-candidate", ({ to, candidate }) => {
        io.to(to).emit("ice-candidate", { candidate });
    });

    // ================= 🔥 TRANSLATION =================
    socket.on("send-translation", ({ to, text, lang }) => {

        console.log("🌍 Sending translation to:", to);

        io.to(to).emit("receive-translation", {
            text,
            lang
        });
    });

    // ================= DISCONNECT =================
    socket.on("disconnect", () => {

        console.log("🔴 Disconnected:", socket.id);

        for (let email in users) {
            if (users[email] === socket.id) {
                delete users[email];
                console.log("❌ Removed user:", email);
            }
        }
    });
});


// ================= START =================
server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
