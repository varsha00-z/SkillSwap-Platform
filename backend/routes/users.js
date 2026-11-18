const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { createToken, requireAuth, sameUser } = require("../middleware/auth");

const router = express.Router();

console.log("✅ SkillSwap users.js routes loaded");

const PUBLIC_USER_FIELDS = `
    id, name, email, skill_offered, skill_wanted
`;

const normalize = (value) => String(value ?? "").trim();

const isValidEmail = (email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isPositiveInteger = (value) =>
    Number.isInteger(Number(value)) && Number(value) > 0;

const isBcryptHash = (value) =>
    typeof value === "string" && /^\$2[aby]?\$\d{2}\$/.test(value);

const query = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });

// REGISTER
router.post("/register", async (req, res) => {
    try {
        const name = normalize(req.body.name);
        const email = normalize(req.body.email).toLowerCase();
        const password = String(req.body.password ?? "");
        const skill_offered = normalize(req.body.skill_offered);
        const skill_wanted = normalize(req.body.skill_wanted);

        if (!name || !email || !password || !skill_offered || !skill_wanted) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        if (name.length < 2) {
            return res.status(400).json({
                message: "Name must be at least 2 characters."
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                message: "Please enter a valid email address."
            });
        }

        if (password.length < 6 || password.length > 72) {
            return res.status(400).json({
                message: "Password must be between 6 and 72 characters."
            });
        }

        if (name.length > 100 || skill_offered.length > 100 || skill_wanted.length > 100) {
            return res.status(400).json({
                message: "Name and skills must be 100 characters or fewer."
            });
        }

        if (email.length > 150) {
            return res.status(400).json({
                message: "Email must be 150 characters or fewer."
            });
        }

        const existing = await query(
            "SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
            [email]
        );

        if (existing.length) {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await query(
            `INSERT INTO users
                (name, email, password, skill_offered, skill_wanted)
             VALUES (?, ?, ?, ?, ?)`,
            [name, email, hashedPassword, skill_offered, skill_wanted]
        );

        res.status(201).json({
            message: "Account created successfully! You can now log in.",
            userId: result.insertId
        });

    } catch (err) {
        console.error("Register error:", err);

        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        res.status(500).json({
            message: "Unable to create account right now."
        });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const email = normalize(req.body.email).toLowerCase();
        const password = String(req.body.password ?? "");

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required."
            });
        }

        const users = await query(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
            [email]
        );

        if (!users.length) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = users[0];
        let passwordValid = false;

        if (isBcryptHash(user.password)) {
            passwordValid = await bcrypt.compare(password, user.password);
        } else {
            passwordValid = password === user.password;

            if (passwordValid) {
                const upgradedHash = await bcrypt.hash(password, 10);

                await query(
                    "UPDATE users SET password = ? WHERE id = ?",
                    [upgradedHash, user.id]
                );
            }
        }

        if (!passwordValid) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const safeUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            skill_offered: user.skill_offered,
            skill_wanted: user.skill_wanted
        };

        res.json({
            message: "Welcome back!",
            token: createToken(user.id),
            user: safeUser
        });

    } catch (err) {
        console.error("Login error:", err);

        res.status(500).json({
            message: "Unable to log in right now."
        });
    }
});

// AUTHENTICATION REQUIRED
router.use(requireAuth);

// CURRENT USER
router.get("/me", async (req, res) => {
    try {
        const users = await query(
            `SELECT ${PUBLIC_USER_FIELDS}
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [req.user.id]
        );

        if (!users.length) {
            return res.status(401).json({
                message: "Account no longer exists."
            });
        }

        res.json({ user: users[0] });

    } catch (err) {
        console.error("Current user error:", err);

        res.status(500).json({
            message: "Unable to load your account."
        });
    }
});

// GET ALL USERS
router.get("/", async (req, res) => {
    try {
        const users = await query(`
            SELECT ${PUBLIC_USER_FIELDS}
            FROM users
            ORDER BY name ASC
        `);

        res.json(users);

    } catch (err) {
        console.error("Fetch users error:", err);

        res.status(500).json({
            message: "Error fetching users."
        });
    }
});

// FIND SKILL MATCHES
router.get("/match", async (req, res) => {
    try {
        const offer = normalize(req.query.offer);
        const want = normalize(req.query.want);
        const excludeUserId = Number(req.user.id);

        if (!offer || !want) {
            return res.status(400).json({
                message: "Both skills are required."
            });
        }

        const users = await query(`
            SELECT ${PUBLIC_USER_FIELDS}
            FROM users
            WHERE LOWER(skill_offered) = LOWER(?)
              AND LOWER(skill_wanted) = LOWER(?)
              AND id <> ?
            ORDER BY name ASC
        `, [want, offer, excludeUserId]);

        res.json(users);

    } catch (err) {
        console.error("Match error:", err);

        res.status(500).json({
            message: "Error finding matches."
        });
    }
});

// SEND SWAP REQUEST
router.post("/request", async (req, res) => {
    try {
        const senderId = Number(req.user.id);
        const receiverId = Number(req.body.receiverId);

        if (!isPositiveInteger(senderId) || !isPositiveInteger(receiverId)) {
            return res.status(400).json({
                message: "Invalid user information."
            });
        }

        if (senderId === receiverId) {
            return res.status(400).json({
                message: "You cannot send a request to yourself."
            });
        }

        const receiver = await query(
            "SELECT id FROM users WHERE id = ? LIMIT 1",
            [receiverId]
        );

        if (!receiver.length) {
            return res.status(404).json({
                message: "User not found."
            });
        }

        const existing = await query(`
            SELECT id, status
            FROM swap_requests
            WHERE (sender_id = ? AND receiver_id = ?)
               OR (sender_id = ? AND receiver_id = ?)
            ORDER BY id DESC
        `, [senderId, receiverId, receiverId, senderId]);

        if (existing.some(request => request.status === "accepted")) {
            return res.status(409).json({
                message: "You are already connected with this user."
            });
        }

        if (existing.some(request => request.status === "pending")) {
            return res.status(409).json({
                message: "A pending request already exists between you and this user."
            });
        }

        const result = await query(`
            INSERT INTO swap_requests
                (sender_id, receiver_id, status)
            VALUES (?, ?, 'pending')
        `, [senderId, receiverId]);

        res.status(201).json({
            message: "Swap request sent successfully!",
            requestId: result.insertId
        });

    } catch (err) {
        console.error("Send request error:", err);

        res.status(500).json({
            message: "Error sending swap request."
        });
    }
});

// RECEIVED REQUESTS
router.get("/requests/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!userId || !sameUser(req, userId)) {
            return res.status(403).json({
                message: "You can only access your own requests."
            });
        }

        const requests = await query(`
            SELECT
                sr.id,
                sr.sender_id,
                sr.receiver_id,
                sr.status,
                sr.created_at,
                u.name AS sender_name,
                u.email AS sender_email,
                u.skill_offered,
                u.skill_wanted
            FROM swap_requests sr
            JOIN users u ON sr.sender_id = u.id
            WHERE sr.receiver_id = ?
            ORDER BY sr.created_at DESC, sr.id DESC
        `, [userId]);

        res.json(requests);

    } catch (err) {
        console.error("Received requests error:", err);

        res.status(500).json({
            message: "Error fetching received requests."
        });
    }
});

// SENT REQUESTS
router.get("/requests/:userId/sent", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!userId || !sameUser(req, userId)) {
            return res.status(403).json({
                message: "You can only access your own requests."
            });
        }

        const requests = await query(`
            SELECT
                sr.id,
                sr.sender_id,
                sr.receiver_id,
                sr.status,
                sr.created_at,
                u.name AS receiver_name,
                u.email AS receiver_email,
                u.skill_offered,
                u.skill_wanted
            FROM swap_requests sr
            JOIN users u ON sr.receiver_id = u.id
            WHERE sr.sender_id = ?
            ORDER BY sr.created_at DESC, sr.id DESC
        `, [userId]);

        res.json(requests);

    } catch (err) {
        console.error("Sent requests error:", err);

        res.status(500).json({
            message: "Error fetching sent requests."
        });
    }
});

// ACCEPT / REJECT REQUEST
router.put("/requests/:requestId", async (req, res) => {
    try {
        const requestId = Number(req.params.requestId);
        const userId = Number(req.user.id);
        const status = normalize(req.body.status).toLowerCase();

        if (!isPositiveInteger(requestId) || !isPositiveInteger(userId)) {
            return res.status(400).json({
                message: "Invalid request information."
            });
        }

        if (!["accepted", "rejected"].includes(status)) {
            return res.status(400).json({
                message: "Invalid status."
            });
        }

        const request = await query(
            `SELECT id, status, sender_id, receiver_id
             FROM swap_requests
             WHERE id = ? AND receiver_id = ?
             LIMIT 1`,
            [requestId, userId]
        );

        if (!request.length) {
            return res.status(404).json({
                message: "Request not found or not assigned to you."
            });
        }

        if (request[0].status !== "pending") {
            return res.status(409).json({
                message: "This request has already been processed."
            });
        }

        await query(
            `UPDATE swap_requests
             SET status = ?
             WHERE id = ? AND receiver_id = ?`,
            [status, requestId, userId]
        );

        if (status === "accepted") {
            await query(`
                UPDATE swap_requests
                SET status = 'rejected'
                WHERE status = 'pending'
                  AND sender_id = ?
                  AND receiver_id = ?
            `, [request[0].receiver_id, request[0].sender_id]);
        }

        res.json({
            message: `Request ${status} successfully.`
        });

    } catch (err) {
        console.error("Update request error:", err);

        res.status(500).json({
            message: "Error updating request."
        });
    }
});
// ------------------------------------------------------------
// GET CONNECTIONS
// ------------------------------------------------------------
router.get("/connections/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!isPositiveInteger(userId) || !sameUser(req, userId)) {
            return res.status(403).json({
                message: "You can only access your own connections."
            });
        }

        const connections = await query(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.skill_offered,
                u.skill_wanted,
                sr.id AS request_id,
                sr.created_at AS connected_at
            FROM swap_requests sr
            JOIN users u
                ON u.id = CASE
                    WHEN sr.sender_id = ? THEN sr.receiver_id
                    ELSE sr.sender_id
                END
            WHERE
                (sr.sender_id = ? OR sr.receiver_id = ?)
                AND sr.status = 'accepted'
            ORDER BY sr.created_at DESC
        `, [userId, userId, userId]);

        res.json(connections);

    } catch (err) {
        console.error("Connections error:", err);
        res.status(500).json({
            message: "Error fetching your connections."
        });
    }
});


// ------------------------------------------------------------
// CHAT - GET MESSAGES
// ------------------------------------------------------------
router.get("/chat/:userId", async (req, res) => {
    try {
        const senderId = Number(req.user.id);
        const receiverId = Number(req.params.userId);

        if (!isPositiveInteger(receiverId) || senderId === receiverId) {
            return res.status(400).json({
                message: "Invalid connection."
            });
        }

        // Only accepted connections can chat.
        const connection = await query(`
            SELECT id
            FROM swap_requests
            WHERE status = 'accepted'
              AND (
                  (sender_id = ? AND receiver_id = ?)
                  OR
                  (sender_id = ? AND receiver_id = ?)
              )
            LIMIT 1
        `, [senderId, receiverId, receiverId, senderId]);

        if (!connection.length) {
            return res.status(403).json({
                message: "You can only chat with accepted connections."
            });
        }

        const messages = await query(`
            SELECT id, sender_id, receiver_id, message, created_at
            FROM chat_messages
            WHERE
                (sender_id = ? AND receiver_id = ?)
                OR
                (sender_id = ? AND receiver_id = ?)
            ORDER BY created_at DESC, id DESC
            LIMIT 500
        `, [senderId, receiverId, receiverId, senderId]);

        res.json(messages.reverse());

    } catch (err) {
        console.error("Chat fetch error:", err);
        res.status(500).json({
            message: "Unable to load chat messages."
        });
    }
});


// ------------------------------------------------------------
// CHAT - SEND MESSAGE
// ------------------------------------------------------------
router.post("/chat/:userId", async (req, res) => {
    try {
        const senderId = Number(req.user.id);
        const receiverId = Number(req.params.userId);
        const message = normalize(req.body.message);

        if (!isPositiveInteger(receiverId) || senderId === receiverId) {
            return res.status(400).json({
                message: "Invalid connection."
            });
        }

        if (!message) {
            return res.status(400).json({
                message: "Message cannot be empty."
            });
        }

        if (message.length > 2000) {
            return res.status(400).json({
                message: "Message cannot exceed 2000 characters."
            });
        }

        // Verify accepted connection before sending.
        const connection = await query(`
            SELECT id
            FROM swap_requests
            WHERE status = 'accepted'
              AND (
                  (sender_id = ? AND receiver_id = ?)
                  OR
                  (sender_id = ? AND receiver_id = ?)
              )
            LIMIT 1
        `, [senderId, receiverId, receiverId, senderId]);

        if (!connection.length) {
            return res.status(403).json({
                message: "You can only message accepted connections."
            });
        }

        const result = await query(`
            INSERT INTO chat_messages
                (sender_id, receiver_id, message)
            VALUES (?, ?, ?)
        `, [senderId, receiverId, message]);

        const savedMessages = await query(`
            SELECT id, sender_id, receiver_id, message, created_at
            FROM chat_messages
            WHERE id = ?
            LIMIT 1
        `, [result.insertId]);

        res.status(201).json({
            message: "Message sent successfully!",
            chatMessage: savedMessages[0]
        });

    } catch (err) {
        console.error("Send chat message error:", err);
        res.status(500).json({
            message: "Unable to send message."
        });
    }
});


// ------------------------------------------------------------
// UPDATE PROFILE
// ------------------------------------------------------------
router.put("/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!isPositiveInteger(userId) || !sameUser(req, userId)) {
            return res.status(403).json({
                message: "You can only update your own profile."
            });
        }

        const name = normalize(req.body.name);
        const skill_offered = normalize(req.body.skill_offered);
        const skill_wanted = normalize(req.body.skill_wanted);

        if (!name || !skill_offered || !skill_wanted) {
            return res.status(400).json({
                message: "Please provide all profile fields."
            });
        }

        if (
            name.length < 2 ||
            name.length > 100 ||
            skill_offered.length > 100 ||
            skill_wanted.length > 100
        ) {
            return res.status(400).json({
                message: "Name must be 2–100 characters and each skill must be 100 characters or fewer."
            });
        }

        const result = await query(`
            UPDATE users
            SET name = ?, skill_offered = ?, skill_wanted = ?
            WHERE id = ?
        `, [name, skill_offered, skill_wanted, userId]);

        if (!result.affectedRows) {
            return res.status(404).json({
                message: "User not found."
            });
        }

        const users = await query(
            `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );

        res.json({
            message: "Profile updated successfully!",
            user: users[0]
        });

    } catch (err) {
        console.error("Profile update error:", err);
        res.status(500).json({
            message: "Error updating profile."
        });
    }
});


// ------------------------------------------------------------
// EXPORT ROUTER
// ------------------------------------------------------------
module.exports = router;