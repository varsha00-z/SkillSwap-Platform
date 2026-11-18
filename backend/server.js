const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const express = require("express");
const cors = require("cors");
const usersRoutes = require("./routes/users");
require("./config/db");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const frontendPath = path.join(__dirname, "..", "frontend");

app.disable("x-powered-by");

const allowedOrigins = new Set([
    `http://localhost:${PORT}`,
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(value => value.trim()).filter(Boolean) : [])
]);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error("CORS origin is not allowed."));
    }
}));

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        service: "SkillSwap API",
        time: new Date().toISOString()
    });
});

app.use("/api/users", usersRoutes);

app.use("/api", (req, res) => {
    res.status(404).json({ message: "API endpoint not found." });
});

app.use(express.static(frontendPath));

app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: "Unexpected server error." });
});

app.listen(PORT, () => {
    console.log(`🚀 SkillSwap running at http://localhost:${PORT}`);
});
