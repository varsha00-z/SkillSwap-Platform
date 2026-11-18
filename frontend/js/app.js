const API_BASE = window.location.protocol === "file:" || ["5500", "5501"].includes(window.location.port)
    ? "http://localhost:5000/api/users"
    : "/api/users";

const STORAGE_KEY = "skillSwapSession";
const THEME_KEY = "skillSwapTheme";

let currentUser = null;
let authToken = null;
let allUsers = [];
let receivedRequests = [];
let sentRequests = [];
let connections = [];
let activeRequestTab = "received";

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function initials(name) {
    const text = String(name || "U").trim();
    return text.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U";
}

function showToast(message, type = "success") {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
        toast.className = "toast";
    }, 3200);
}

function setMessage(element, message, type = "success") {
    element.textContent = message;
    element.className = `form-message ${type}`;
}

async function api(path, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        // Empty response
    }

    if (!response.ok) {
        if (
            response.status === 401 &&
            authToken &&
            !path.includes("/login") &&
            !path.includes("/register")
        ) {
            clearUser();
            showAuth("login");
            showToast("Your session has expired. Please sign in again.", "error");
        }

        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}

function saveSession(user, token = authToken) {
    currentUser = user;
    authToken = token;

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user, token })
    );
}

function saveUser(user) {
    saveSession(user, authToken);
}

function clearUser() {
    currentUser = null;
    authToken = null;

    localStorage.removeItem(STORAGE_KEY);
}

function showAuth(tab = "login") {
    $("authScreen").classList.remove("hidden");
    $("appShell").classList.add("hidden");

    switchAuthTab(tab);
}

function showApp() {
    $("authScreen").classList.add("hidden");
    $("appShell").classList.remove("hidden");

    updateUserUI();
    navigate("dashboard");
    refreshApp();
}

function switchAuthTab(tab) {
    document.querySelectorAll("[data-auth-tab]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.authTab === tab);
    });

    $("loginForm").classList.toggle("hidden", tab !== "login");
    $("registerForm").classList.toggle("hidden", tab !== "register");
}

function updateUserUI() {
    if (!currentUser) return;

    const name = currentUser.name || "User";

    $("navUserName").textContent = name;

    $("navUserSkill").textContent = currentUser.skill_offered
        ? `Teaches ${currentUser.skill_offered}`
        : "SkillSwap member";

    $("avatar").textContent = initials(name);
    $("welcomeName").textContent = name.split(" ")[0];

    $("profileAvatar").textContent = initials(name);
    $("profileName").textContent = name;
    $("profileEmail").textContent = currentUser.email || "";

    $("profileNameInput").value = name;
    $("profileEmailInput").value = currentUser.email || "";

    $("profileOffer").value = currentUser.skill_offered || "";
    $("profileWant").value = currentUser.skill_wanted || "";

    $("offerSkill").value = currentUser.skill_offered || "";
    $("wantSkill").value = currentUser.skill_wanted || "";
}

/* NAVIGATION */
function navigate(section) {
    const sections = {
        dashboard: $("dashboardSection"),
        discover: $("discoverSection"),
        requests: $("requestsSection"),
        connections: $("connectionsSection"),
        chat: $("chatSection"),
        profile: $("profileSection")
    };

    Object.entries(sections).forEach(([key, element]) => {
        if (element) {
            element.classList.toggle(
                "active-section",
                key === section
            );
        }
    });

    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.nav === section);
    });

    closeMobileNav();
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (section === "connections" && currentUser) {
        loadConnections();
    }
}
/* REGISTRATION */

async function register() {
    const data = {
        name: $("name").value.trim(),
        email: $("email").value.trim(),
        password: $("password").value,
        skill_offered: $("skill_offered").value.trim(),
        skill_wanted: $("skill_wanted").value.trim()
    };

    const message = $("registerMessage");

    setMessage(message, "Creating your account…", "loading");

    try {
        await api("/register", {
            method: "POST",
            body: JSON.stringify(data)
        });

        setMessage(message, "Account created! Switching you to login…", "success");

        $("registerForm").reset();

        setTimeout(() => switchAuthTab("login"), 650);

    } catch (error) {
        setMessage(message, error.message, "error");
    }
}

/* LOGIN */

async function login() {
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;

    const message = $("loginMessage");

    setMessage(message, "Signing you in…", "loading");

    try {
        const result = await api("/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        saveSession(result.user, result.token);

        $("loginForm").reset();

        showApp();

        showToast("Welcome back! Your dashboard is ready.");

    } catch (error) {
        setMessage(message, error.message, "error");
    }
}

/* SKILL MATCHING */

async function findMatches() {
    const offer = $("offerSkill").value.trim();
    const want = $("wantSkill").value.trim();

    const container = $("matches");

    if (!offer || !want) {
        showToast("Enter both skills to find a match.", "error");
        return;
    }

    container.innerHTML = `
        <div class="loading-card glass-card">
            <span class="spinner"></span>
            <p>Finding your best matches…</p>
        </div>
    `;

    try {
        const users = await api(
            `/match?offer=${encodeURIComponent(offer)}&want=${encodeURIComponent(want)}`
        );

        renderUserCards(container, users, "match");

        $("statMatches").textContent = users.length;

        if (users.length) {
            showToast(`${users.length} skill match${users.length === 1 ? "" : "es"} found!`);
        }

    } catch (error) {
        container.innerHTML = emptyState(
            "Could not load matches",
            error.message,
            "↻"
        );
    }
}

/* USER CARDS */

function userCard(user, mode = "discover") {
    const isSelf = currentUser &&
        Number(user.id) === Number(currentUser.id);

    const outgoing = sentRequests.find(
        r => Number(r.receiver_id) === Number(user.id)
    );

    const incoming = receivedRequests.find(
        r => Number(r.sender_id) === Number(user.id)
    );

    const relationship = [outgoing, incoming].find(
        request => request?.status === "accepted"
    )
        ? "accepted"
        : [outgoing, incoming].find(
            request => request?.status === "pending"
        )?.status || "none";

    let action;

    if (isSelf) {
        action = `<span class="self-tag">You</span>`;

    } else if (
        relationship === "pending" &&
        incoming?.status === "pending"
    ) {
        action = `
            <button class="outline-btn" data-nav="requests" type="button">
                Review request <span>→</span>
            </button>
        `;

    } else if (relationship === "pending") {
        action = `<span class="self-tag pending-tag">Request pending</span>`;

    } else if (relationship === "accepted") {
        action = `<span class="self-tag connected-tag">Connected ✓</span>`;

    } else {
        action = `
            <button class="outline-btn request-action"
                data-user-id="${Number(user.id)}" type="button">
                Send request <span>→</span>
            </button>
        `;
    }

    return `
        <article class="person-card glass-card">
            <div class="card-topline">
                <span class="mini-label">
                    ${mode === "match" ? "MATCH FOUND" : "SKILLSWAP MEMBER"}
                </span>
                <span class="status-dot"></span>
            </div>

            <div class="person-main">
                <div class="person-avatar">
                    ${escapeHtml(initials(user.name))}
                </div>

                <div>
                    <h3>${escapeHtml(user.name)}</h3>
                    <p>${escapeHtml(user.email)}</p>
                </div>
            </div>

            <div class="skill-pair">
                <div>
                    <span>CAN TEACH</span>
                    <strong>${escapeHtml(user.skill_offered)}</strong>
                </div>

                <div class="pair-arrow">↔</div>

                <div>
                    <span>WANTS</span>
                    <strong>${escapeHtml(user.skill_wanted)}</strong>
                </div>
            </div>

            <div class="card-action">${action}</div>
        </article>
    `;
}

function renderUserCards(container, users, mode = "discover") {
    if (mode === "discover" && $("discoverCount")) {
        $("discoverCount").textContent =
            `${users.length} ${users.length === 1 ? "person" : "people"}`;
    }

    if (!users.length) {
        container.innerHTML = emptyState(
            mode === "match" ? "No perfect matches yet" : "No people found",
            mode === "match"
                ? "Try another skill combination or update your profile."
                : "Try a different name or skill.",
            "⌕"
        );

        return;
    }

    container.innerHTML = users
        .map(user => userCard(user, mode))
        .join("");
}

function emptyState(title, copy, icon = "◎") {
    return `
        <div class="empty-state glass-card">
            <div class="empty-icon">${icon}</div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(copy)}</p>
        </div>
    `;
}

/* DISCOVER USERS */

async function loadUsers() {
    try {
        allUsers = await api("");

        renderUserCards(
            $("usersList"),
            filteredUsers(),
            "discover"
        );

        $("statUsers").textContent = allUsers.length;

    } catch (error) {
        $("usersList").innerHTML = emptyState(
            "Community unavailable",
            error.message,
            "!"
        );
    }
}

function filteredUsers() {
    const search = $("discoverSearch").value.trim().toLowerCase();
    const filter = $("discoverFilter").value;

    return allUsers.filter(user => {
        if (
            currentUser &&
            Number(user.id) === Number(currentUser.id)
        ) {
            return false;
        }

        const matchesSearch = !search || [
            user.name,
            user.email,
            user.skill_offered,
            user.skill_wanted
        ].some(value =>
            String(value || "").toLowerCase().includes(search)
        );

        const matchesFilter = filter === "all"
            || (
                filter === "teaches" &&
                Boolean(String(user.skill_offered || "").trim())
            )
            || (
                filter === "learns" &&
                Boolean(String(user.skill_wanted || "").trim())
            );

        return matchesSearch && matchesFilter;
    });
}

/* CONNECTIONS FEATURE - NEW */

function renderConnections() {
    $("connectionCount").textContent = connections.length;
    $("connectionBadge").textContent = connections.length;

    $("connectionBadge").classList.toggle(
        "hidden",
        connections.length === 0
    );

    if (!connections.length) {
        $("connectionsList").innerHTML = emptyState(
            "No connections yet",
            "Accept a swap request to start building your learning network.",
            "🤝"
        );

        return;
    }

    $("connectionsList").innerHTML = connections.map(user => `
        <article class="person-card glass-card">

            <div class="card-topline">
                <span class="mini-label">YOUR CONNECTION</span>
                <span class="status-dot"></span>
            </div>

            <div class="person-main">
                <div class="person-avatar">
                    ${escapeHtml(initials(user.name))}
                </div>

                <div>
                    <h3>${escapeHtml(user.name)}</h3>
                    <p>${escapeHtml(user.email)}</p>
                </div>
            </div>

            <div class="skill-pair">
                <div>
                    <span>CAN TEACH</span>
                    <strong>${escapeHtml(user.skill_offered)}</strong>
                </div>

                <div class="pair-arrow">↔</div>

                <div>
                    <span>WANTS</span>
                    <strong>${escapeHtml(user.skill_wanted)}</strong>
                </div>
            </div>

            <div class="card-action">
                <span class="self-tag connected-tag">
                    Connected ✓
                </span>

                <button
                    type="button"
                    class="btn btn-primary"
                    onclick="openChat(${Number(user.id)})"
                >
                    💬 Chat Now
                </button>
            </div>

        </article>
    `).join("");
}

async function loadConnections() {
    if (!currentUser) return;

    $("connectionsList").innerHTML = `
        <div class="loading-card glass-card">
            <span class="spinner"></span>
            <p>Loading your connections...</p>
        </div>
    `;

    try {
        connections = await api(
            `/connections/${currentUser.id}`
        );

        renderConnections();

    } catch (error) {
        $("connectionsList").innerHTML = emptyState(
            "Could not load connections",
            error.message,
            "!"
        );
    }
}

/* RECEIVED REQUESTS */

async function loadReceivedRequests() {
    if (!currentUser) return;

    try {
        receivedRequests = await api(
            `/requests/${currentUser.id}`
        );

        renderRequests();
        updateStats();

    } catch (error) {
        $("receivedPanel").innerHTML = emptyState(
            "Could not load requests",
            error.message,
            "!"
        );
    }
}

/* SENT REQUESTS */

async function loadSentRequests() {
    if (!currentUser) return;

    try {
        sentRequests = await api(
            `/requests/${currentUser.id}/sent`
        );

        renderRequests();
        updateStats();

    } catch (error) {
        $("sentPanel").innerHTML = emptyState(
            "Could not load sent requests",
            error.message,
            "!"
        );
    }
}

function statusBadge(status) {
    const value = String(status || "pending").toLowerCase();

    return `
        <span class="status-badge ${escapeHtml(value)}">
            <span></span>${escapeHtml(value)}
        </span>
    `;
}

function requestCard(request, type) {
    const isReceived = type === "received";

    const personName = isReceived
        ? request.sender_name
        : request.receiver_name;

    const personEmail = isReceived
        ? request.sender_email
        : request.receiver_email;

    const actions = isReceived && request.status === "pending"
        ? `
            <div class="request-actions">
                <button class="accept-btn request-status-action"
                    data-request-id="${Number(request.id)}"
                    data-status="accepted" type="button">
                    Accept
                </button>

                <button class="reject-btn request-status-action"
                    data-request-id="${Number(request.id)}"
                    data-status="rejected" type="button">
                    Decline
                </button>
            </div>
        `
        : "";

    return `
        <article class="request-card glass-card">
            <div class="request-avatar">
                ${escapeHtml(initials(personName))}
            </div>

            <div class="request-content">
                <div class="request-heading">
                    <div>
                        <h3>${escapeHtml(personName || "Unknown user")}</h3>
                        <p>${escapeHtml(personEmail || "")}</p>
                    </div>

                    ${statusBadge(request.status)}
                </div>

                <div class="request-skills">
                    <span>Offers <strong>${escapeHtml(request.skill_offered || "—")}</strong></span>
                    <span>Wants <strong>${escapeHtml(request.skill_wanted || "—")}</strong></span>
                </div>

                <small class="request-meta">
                    Request #${Number(request.id)} · ${formatDate(request.created_at)}
                </small>

                ${actions}
            </div>
        </article>
    `;
}

function formatDate(date) {
    if (!date) return "Recently";

    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) {
        return "Recently";
    }

    return parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function renderRequests() {
    $("receivedCount").textContent = receivedRequests.length;
    $("sentCount").textContent = sentRequests.length;

    const pending = receivedRequests.filter(
        request => request.status === "pending"
    ).length;

    $("navBadge").textContent = pending;

    $("navBadge").classList.toggle(
        "hidden",
        pending === 0
    );

    $("receivedPanel").innerHTML = receivedRequests.length
        ? receivedRequests.map(request => requestCard(request, "received")).join("")
        : emptyState(
            "No incoming requests",
            "When someone wants to exchange skills with you, their request will appear here.",
            "↓"
        );

    $("sentPanel").innerHTML = sentRequests.length
        ? sentRequests.map(request => requestCard(request, "sent")).join("")
        : emptyState(
            "No sent requests",
            "Find a skill match and send your first swap request.",
            "↑"
        );
}

/* SEND REQUEST */

async function sendRequest(receiverId) {
    if (!currentUser) {
        showAuth("login");
        showToast("Please sign in before sending a request.", "error");
        return;
    }

    const buttons = document.querySelectorAll(
        `.request-action[data-user-id="${receiverId}"]`
    );

    buttons.forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner tiny"></span> Sending`;
    });

    try {
        await api("/request", {
            method: "POST",
            body: JSON.stringify({ receiverId })
        });

        showToast("Swap request sent successfully!");

        await loadSentRequests();

        renderUserCards(
            $("usersList"),
            filteredUsers(),
            "discover"
        );

        await findMatchesSilently();

        updateStats();

    } catch (error) {
        showToast(error.message, "error");

        buttons.forEach(btn => {
            btn.disabled = false;
            btn.innerHTML = `Send request <span>→</span>`;
        });
    }
}

async function findMatchesSilently() {
    if (
        !currentUser?.skill_offered ||
        !currentUser?.skill_wanted
    ) {
        return;
    }

    try {
        const users = await api(
            `/match?offer=${encodeURIComponent(currentUser.skill_offered)}&want=${encodeURIComponent(currentUser.skill_wanted)}`
        );

        renderUserCards($("matches"), users, "match");

        $("statMatches").textContent = users.length;

    } catch {
        // Keep current UI
    }
}

/* ACCEPT OR REJECT REQUEST */

async function updateRequestStatus(requestId, status) {
    const actionButtons = document.querySelectorAll(
        `.request-status-action[data-request-id="${requestId}"]`
    );

    actionButtons.forEach(btn => {
        btn.disabled = true;
    });

    try {
        await api(`/requests/${requestId}`, {
            method: "PUT",
            body: JSON.stringify({ status })
        });

        showToast(
            status === "accepted"
                ? "Request accepted. Happy swapping!"
                : "Request declined."
        );

        await Promise.all([
            loadReceivedRequests(),
            loadSentRequests(),
            loadConnections()
        ]);

        await loadUsers();
        await findMatchesSilently();

    } catch (error) {
        showToast(error.message, "error");

        actionButtons.forEach(btn => {
            btn.disabled = false;
        });
    }
}

/* PROFILE UPDATE */

async function saveProfile() {
    const message = $("profileMessage");

    const data = {
        name: $("profileNameInput").value.trim(),
        skill_offered: $("profileOffer").value.trim(),
        skill_wanted: $("profileWant").value.trim()
    };

    setMessage(message, "Saving changes…", "loading");

    try {
        const result = await api(`/${currentUser.id}`, {
            method: "PUT",
            body: JSON.stringify(data)
        });

        saveUser(result.user);

        updateUserUI();

        setMessage(
            message,
            "Profile updated successfully!",
            "success"
        );

        showToast("Your profile is up to date.");

        await Promise.all([
            loadUsers(),
            loadReceivedRequests(),
            loadSentRequests(),
            loadConnections(),
            findMatchesSilently()
        ]);

        updateStats();

    } catch (error) {
        setMessage(message, error.message, "error");
    }
}

/* DASHBOARD STATISTICS */

function updateStats() {
    const pending = receivedRequests.filter(
        request => request.status === "pending"
    ).length;

    const acceptedPairs = new Set();

    [...receivedRequests, ...sentRequests]
        .filter(request => request.status === "accepted")
        .forEach(request => {
            const a = Number(request.sender_id);
            const b = Number(request.receiver_id);

            acceptedPairs.add(
                [Math.min(a, b), Math.max(a, b)].join(":")
            );
        });

    $("statPending").textContent = pending;
    $("statAccepted").textContent = acceptedPairs.size;
}

/* REFRESH APP */

async function refreshApp() {
    await Promise.all([
        loadUsers(),
        loadReceivedRequests(),
        loadSentRequests(),
        loadConnections()
    ]);

    await findMatchesSilently();

    updateStats();
}

/* THEME */

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;

    localStorage.setItem(THEME_KEY, theme);

    $("themeToggle").textContent =
        theme === "dark" ? "☀" : "☾";
}

/* 3D INTERACTIONS */

function setup3DInteractions() {
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!finePointer || reducedMotion) return;

    document.addEventListener("pointermove", event => {
        const card = event.target.closest(".person-card");

        if (!card) return;

        const rect = card.getBoundingClientRect();

        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;

        card.style.setProperty(
            "--rx",
            `${(-y * 4).toFixed(2)}deg`
        );

        card.style.setProperty(
            "--ry",
            `${(x * 5).toFixed(2)}deg`
        );
    });

    document.addEventListener("pointerout", event => {
        const card = event.target.closest(".person-card");

        if (!card || card.contains(event.relatedTarget)) return;

        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
    });
}

/* MOBILE NAVIGATION */

function closeMobileNav() {
    $("mainNav").classList.remove("open");

    $("mobileNavToggle").setAttribute(
        "aria-expanded",
        "false"
    );
}

/* EVENT LISTENERS */

function setupEvents() {
    $("mobileNavToggle").addEventListener("click", () => {
        const nav = $("mainNav");
        const isOpen = nav.classList.toggle("open");

        $("mobileNavToggle").setAttribute(
            "aria-expanded",
            String(isOpen)
        );
    });

    document.querySelectorAll("[data-auth-tab]").forEach(btn => {
        btn.addEventListener("click", () => {
            switchAuthTab(btn.dataset.authTab);
        });
    });

    $("loginForm").addEventListener("submit", event => {
        event.preventDefault();
        login();
    });

    $("registerForm").addEventListener("submit", event => {
        event.preventDefault();
        register();
    });

    $("matchForm").addEventListener("submit", event => {
        event.preventDefault();
        findMatches();
    });

    $("profileForm").addEventListener("submit", event => {
        event.preventDefault();
        saveProfile();
    });

    document.addEventListener("click", event => {
        const nav = event.target.closest("[data-nav]");

        if (nav) {
            navigate(nav.dataset.nav);
        }

        const requestBtn = event.target.closest(".request-action");

        if (requestBtn) {
            sendRequest(Number(requestBtn.dataset.userId));
        }

        const statusBtn = event.target.closest(".request-status-action");

        if (statusBtn) {
            updateRequestStatus(
                Number(statusBtn.dataset.requestId),
                statusBtn.dataset.status
            );
        }
    });

    $("discoverSearch").addEventListener("input", () => {
        renderUserCards(
            $("usersList"),
            filteredUsers(),
            "discover"
        );
    });

    $("discoverFilter").addEventListener("change", () => {
        renderUserCards(
            $("usersList"),
            filteredUsers(),
            "discover"
        );
    });

    document.querySelectorAll(".request-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            activeRequestTab = btn.dataset.requestTab;

            document.querySelectorAll(".request-tab").forEach(tab => {
                tab.classList.toggle("active", tab === btn);
            });

            $("receivedPanel").classList.toggle(
                "hidden",
                activeRequestTab !== "received"
            );

            $("sentPanel").classList.toggle(
                "hidden",
                activeRequestTab !== "sent"
            );
        });
    });

    $("logoutBtn").addEventListener("click", () => {
        clearUser();

        allUsers = [];
        receivedRequests = [];
        sentRequests = [];
        connections = [];

        showAuth("login");

        showToast("You have been logged out.");
    });

    $("themeToggle").addEventListener("click", () => {
        const next =
            document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark";

        applyTheme(next);
    });
}

/* INITIALIZATION */

async function init() {
    applyTheme(
        localStorage.getItem(THEME_KEY) || "light"
    );

    localStorage.removeItem("skillSwapUser");

    setupEvents();
    setup3DInteractions();

    try {
        const saved = JSON.parse(
            localStorage.getItem(STORAGE_KEY)
        );

        if (saved?.token && saved?.user?.id) {
            authToken = saved.token;

            const result = await api("/me");

            saveSession(result.user, authToken);

            showApp();

            return;
        }

    } catch {
        clearUser();
    }

    showAuth("login");
}

init();
// ------------------------------------------------------------
// OPEN CHAT
// ------------------------------------------------------------

let activeChatUser = null;
let chatRefreshInterval = null;

async function openChat(userId) {
    const user = connections.find(
        connection => Number(connection.id) === Number(userId)
    );

    if (!user) {
        showToast("Connection not found.", "error");
        return;
    }

    activeChatUser = user;

    navigate("chat");

    $("chatUserName").textContent = user.name;
    $("chatUserStatus").textContent = "Connected on SkillSwap";

    $("chatMessages").innerHTML = `
        <div class="empty-state">
            <p>Loading messages...</p>
        </div>
    `;

    await loadChatMessages();

    // Stop any previous chat refresh
    clearInterval(chatRefreshInterval);

    // Refresh messages every 3 seconds
    chatRefreshInterval = setInterval(() => {
        if (activeChatUser && $("chatSection").classList.contains("active-section")) {
            loadChatMessages();
        }
    }, 3000);
}
// ------------------------------------------------------------
// LOAD CHAT MESSAGES + AUTO SCROLL
// ------------------------------------------------------------

function scrollChatToLatest() {
    const chatBox = $("chatMessages");

    requestAnimationFrame(() => {
        chatBox.scrollTo({
            top: chatBox.scrollHeight,
            behavior: "smooth"
        });
    });
}

async function loadChatMessages() {
    if (!activeChatUser) return;

    try {
        const chatBox = $("chatMessages");

        const response = await api(`/chat/${activeChatUser.id}`);

        const messages = Array.isArray(response)
            ? response
            : response.messages || [];

        // Remove the loading placeholder after messages are fetched
const loadingMessage = chatBox.querySelector(".empty-state");

if (loadingMessage) {
    loadingMessage.remove();
}

// Show a message if the chat is empty
if (messages.length === 0) {
    chatBox.innerHTML = `
        <div class="empty-state">
            <p>No messages yet. Start the conversation!</p>
        </div>
    `;
    return;
}    

        // Check whether this is the first message load
        const isFirstLoad = !chatBox.querySelector(".message-bubble");

        // Check whether the user is near the bottom
        const isNearBottom =
            chatBox.scrollHeight - chatBox.scrollTop -
            chatBox.clientHeight < 100;

        // Find the last displayed message ID
        const displayedMessages =
            chatBox.querySelectorAll(".message-bubble");

        const lastDisplayedId = displayedMessages.length
            ? Number(displayedMessages[displayedMessages.length - 1].dataset.messageId)
            : 0;

        // Find only messages that haven't been displayed
        const newMessages = messages.filter(message =>
            Number(message.id) > lastDisplayedId
        );

        // No new messages? Don't touch the chat
        if (!newMessages.length) return;

        // Add only new messages
        newMessages.forEach(message => {
            const bubble = document.createElement("div");

            bubble.className =
                Number(message.sender_id) === Number(currentUser.id)
                    ? "message-bubble sent"
                    : "message-bubble received";

            bubble.dataset.messageId = message.id;

            bubble.innerHTML = `
                <p>${escapeHtml(message.message)}</p>
                <small>${new Date(message.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                })}</small>
            `;

            chatBox.appendChild(bubble);
        });

        // Scroll on first load or when user was already near bottom
        if (isFirstLoad || isNearBottom) {
            chatBox.scrollTo({
                top: chatBox.scrollHeight,
                behavior: "smooth"
            });
        }

    } catch (error) {
        console.error("Chat loading error:", error);
    }
}
// ------------------------------------------------------------
// SEND CHAT MESSAGE
// ------------------------------------------------------------

async function sendChatMessage(event) {
    event.preventDefault();

    if (!activeChatUser) {
        showToast("Please select a connection first.", "error");
        return;
    }

    const input = $("chatInput");
    const message = input.value.trim();

    if (!message) return;

    if (message.length > 2000) {
        showToast("Message is too long.", "error");
        return;
    }

    try {
        await api(`/chat/${activeChatUser.id}`, {
            method: "POST",
            body: JSON.stringify({ message })
        });

        input.value = "";

        await loadChatMessages();

    } catch (error) {
        showToast(error.message || "Unable to send message.", "error");
    }
}
// ------------------------------------------------------------
// CHAT FORM EVENT
// ------------------------------------------------------------

$("chatForm").addEventListener(
    "submit",
    sendChatMessage
);