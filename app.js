let users = {};
let rooms = {};

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

        if (!targetSocket) return;

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

        // tell old users
        socket.to(roomId).emit("user-joined", {
            socketId: socket.id
        });

        // tell new user existing users
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
    // TRANSLATION
    // =========================

    socket.on("send-translation", ({ to, text, lang }) => {

        io.to(to).emit("receive-translation", {
            text,
            lang
        });
    });

    socket.on("send-translation-room", ({ roomId, text, lang }) => {

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