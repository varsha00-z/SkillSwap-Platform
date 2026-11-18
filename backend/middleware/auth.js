const crypto = require("crypto");

const AUTH_SECRET = process.env.AUTH_SECRET || "skillswap-development-secret-change-me";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function base64Url(value) {
    return Buffer.from(value).toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function createToken(userId) {
    const payload = JSON.stringify({
        sub: Number(userId),
        iat: Date.now()
    });

    const encoded = base64Url(payload);
    const signature = crypto
        .createHmac("sha256", AUTH_SECRET)
        .update(encoded)
        .digest("base64url");

    return `${encoded}.${signature}`;
}

function verifyToken(token) {
    if (!token || typeof token !== "string") return null;

    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;

    const expected = crypto
        .createHmac("sha256", AUTH_SECRET)
        .update(encoded)
        .digest("base64url");

    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (suppliedBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;

    try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        const userId = Number(payload.sub);
        const issuedAt = Number(payload.iat);

        if (!userId || !issuedAt || Date.now() - issuedAt > TOKEN_TTL_MS) return null;
        return { id: userId };
    } catch {
        return null;
    }
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = verifyToken(token);

    if (!user) {
        return res.status(401).json({ message: "Your session is invalid or has expired. Please sign in again." });
    }

    req.user = user;
    next();
}

function sameUser(req, userId) {
    return Number(req.user?.id) === Number(userId);
}

module.exports = { createToken, requireAuth, sameUser };
