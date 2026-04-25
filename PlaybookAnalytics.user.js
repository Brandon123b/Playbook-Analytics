// ==UserScript==
// @name         Playbook Analytics
// @namespace    https://github.com/Brandon123b/Playbook-Analytics
// @version      1.0.0
// @description  Track your Google Play Books reading sessions and visualize progress, pace, and ETA with interactive charts.
// @author       Brandon123b
// @match        https://play.google.com/books/reader*
// @match        https://books.googleusercontent.com/*
// @match        https://example.com/playlytics*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=play.google.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @license      MIT
// @homepageURL  https://github.com/Brandon123b/Playbook-Analytics
// @homepageURL  https://greasyfork.org/en/scripts/575341-playbook-analytics
// @supportURL   https://github.com/Brandon123b/Playbook-Analytics/issues
// @downloadURL  https://raw.githubusercontent.com/Brandon123b/Playbook-Analytics/main/PlaybookAnalytics.user.js
// @updateURL    https://raw.githubusercontent.com/Brandon123b/Playbook-Analytics/main/PlaybookAnalytics.meta.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js
// ==/UserScript==

(function () {
    "use strict";

    // ===== Configuration =====

    const CONFIG = Object.freeze({
        SESSION_GAP_MS: 5 * 60 * 1000,        // 5 minutes between samples = new reading session
        GAP_BETWEEN_SESSIONS_MS: 30000,       // Visual gap between sessions on the chart
        TRACK_INTERVAL_MS: 5000,              // Safety-net poll for URL changes the History hooks miss
        IFRAME_POLL_MS: 2000,                 // How often the iframe re-scans for the page count
        IFRAME_MAX_ATTEMPTS: 30,              // Give up scanning after this many tries (~1 minute)
    });

    const MODES = Object.freeze({
        IFRAME: "IFRAME",
        STATS: "STATS",
        READER: "READER",
        UNKNOWN: "UNKNOWN",
    });

    const READER_ORIGIN = "https://play.google.com";
    const IFRAME_ORIGIN = "https://books.googleusercontent.com";

    const SESSION_COLORS = [
        "#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#f87171",
        "#38bdf8", "#c084fc", "#4ade80", "#facc15", "#fb923c",
    ];

    // ===== Logging =====

    const LOG_PREFIX = "[Playbook Analytics]";
    const log = (...args) => console.log(LOG_PREFIX, ...args);

    // ===== Shared storage =====
    // booksData:     { [bookTitle]: [{ page, timestamp }, ...] }
    // booksMetadata: { [bookTitle]: { totalPages, ... } }

    const Storage = {
        getAllBooksData:     () => GM_getValue("booksData", {}),
        getAllBooksMetadata: () => GM_getValue("booksMetadata", {}),
        getBookData:         (title) => Storage.getAllBooksData()[title] || [],
        getBookMetadata:     (title) => Storage.getAllBooksMetadata()[title] || {},

        saveBookData(title, data) {
            const all = Storage.getAllBooksData();
            all[title] = data;
            GM_setValue("booksData", all);
        },

        saveBookMetadata(title, metadata) {
            const all = Storage.getAllBooksMetadata();
            all[title] = { ...all[title], ...metadata };
            GM_setValue("booksMetadata", all);
        },

        deleteBook(title) {
            const data = Storage.getAllBooksData();
            delete data[title];
            GM_setValue("booksData", data);

            const meta = Storage.getAllBooksMetadata();
            delete meta[title];
            GM_setValue("booksMetadata", meta);
        },

        deleteAll() {
            GM_setValue("booksData", {});
            GM_setValue("booksMetadata", {});
        },
    };

    // ===== Iframe mode =====
    // Runs inside the Google Books rendering iframe to detect total pages
    // and forward them up to the reader page.

    function initIframeMode() {
        log("Iframe mode initialized");

        function detectTotalPages() {
            const text = document.body?.innerText || "";
            const slashPattern = text.match(/(\d+)(?:[–\-](\d+))?\s*\/\s*(\d+)/);
            if (slashPattern) return parseInt(slashPattern[3], 10);

            for (const el of document.querySelectorAll("[aria-label]")) {
                const label = el.getAttribute("aria-label");
                const match = label && label.match(/(\d+)(?:[–\-](\d+))?\s*\/\s*(\d+)/);
                if (match) return parseInt(match[3], 10);
            }
            return null;
        }

        let attempts = 0;
        let intervalId = null;

        function send() {
            attempts++;
            const totalPages = detectTotalPages();
            if (totalPages) {
                try {
                    window.parent.postMessage({ type: "GPB_TOTAL_PAGES", totalPages }, READER_ORIGIN);
                } catch (_) { /* parent may be gone */ }
                if (intervalId) clearInterval(intervalId);
            } else if (attempts >= CONFIG.IFRAME_MAX_ATTEMPTS) {
                if (intervalId) clearInterval(intervalId);
            }
        }

        intervalId = setInterval(send, CONFIG.IFRAME_POLL_MS);
        setTimeout(send, 1000);
    }

    // ===== Stats mode =====
    // Standalone analytics dashboard. Wipes the page and renders a custom UI.

    const STATS_CSS = `
        *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        html, body {
            width: 100%;
            min-height: 100vh;
        }
        body {
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e8e8e8;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 20px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #334155;
        }
        h1 {
            font-size: 2em;
            background: linear-gradient(90deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .controls {
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }
        select, button {
            padding: 10px 16px;
            border-radius: 8px;
            border: 1px solid #475569;
            background: #1e293b;
            color: #e2e8f0;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
        }
        select:hover, button:hover {
            background: #334155;
            border-color: #60a5fa;
        }
        select { min-width: 250px; }
        .btn-danger { background: #7f1d1d; border-color: #991b1b; }
        .btn-danger:hover { background: #991b1b; border-color: #dc2626; }
        .btn-refresh { background: #065f46; border-color: #047857; }
        .btn-refresh:hover { background: #047857; border-color: #10b981; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: #1e293b;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 1px solid #334155;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #60a5fa;
            margin-bottom: 5px;
        }
        .stat-label { color: #94a3b8; font-size: 0.9em; }
        .chart-container {
            background: #0f172a;
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            margin-bottom: 30px;
        }
        .chart-title {
            color: #94a3b8;
            font-size: 1.1em;
            margin-bottom: 15px;
            font-weight: 500;
        }
        #readingChart { width: 100% !important; height: 500px !important; }
        #dailyChart   { width: 100% !important; height: 300px !important; }
        .no-data { text-align: center; padding: 50px; color: #94a3b8; }
    `;

    const STATS_HTML = `
        <div class="container">
            <header>
                <h1>📚 Playbook Analytics</h1>
                <div class="controls">
                    <select id="bookSelect"></select>
                    <button id="refreshData" class="btn-refresh">🔄 Refresh</button>
                    <button id="resetZoom">🔍 Reset Zoom</button>
                    <button id="deleteBook" class="btn-danger">🗑️ Delete Book</button>
                    <button id="deleteAll" class="btn-danger">⚠️ Delete All</button>
                </div>
            </header>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value" id="pageProgress">-</div><div class="stat-label">Page Progress</div></div>
                <div class="stat-card"><div class="stat-value" id="percentComplete">-</div><div class="stat-label">% Complete</div></div>
                <div class="stat-card"><div class="stat-value" id="pagesRemaining">-</div><div class="stat-label">Pages Left</div></div>
                <div class="stat-card"><div class="stat-value" id="totalTime">-</div><div class="stat-label">Reading Time</div></div>
                <div class="stat-card"><div class="stat-value" id="avgSpeed">-</div><div class="stat-label">Avg Pages/Hour</div></div>
                <div class="stat-card"><div class="stat-value" id="estTimeToFinish">-</div><div class="stat-label">Est. Time Left</div></div>
                <div class="stat-card"><div class="stat-value" id="fastestSession">-</div><div class="stat-label">Fastest Session</div></div>
                <div class="stat-card"><div class="stat-value" id="sessionCount">-</div><div class="stat-label">Sessions</div></div>
            </div>
            <div class="chart-container">
                <div class="chart-title">📈 Reading Progress</div>
                <canvas id="readingChart"></canvas>
            </div>
            <div class="chart-container">
                <div class="chart-title">📅 Pages Read Per Day</div>
                <canvas id="dailyChart"></canvas>
            </div>
        </div>
    `;

    const NO_DATA_HTML = `
        <div class="container">
            <div class="no-data">
                <h2>📚 No Reading Data Yet</h2>
                <p>Start reading a book to track your progress!</p>
                <button onclick="location.reload()">🔄 Refresh</button>
            </div>
        </div>
    `;

    function formatDuration(ms) {
        const hours = Math.floor(ms / 3600000);
        const mins = Math.floor((ms % 3600000) / 60000);
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    // Group raw page samples into sessions (gap > SESSION_GAP_MS = new session)
    // and build the chart series with synthetic, gap-padded x coordinates.
    function processBookData(data, totalPagesInBook) {
        if (!data || data.length === 0) return { sessions: [], chartData: [], sessionStats: [] };

        const sorted = data.slice().sort((a, b) => a.timestamp - b.timestamp);
        const sessions = [];
        let currentSession = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].timestamp - sorted[i - 1].timestamp > CONFIG.SESSION_GAP_MS) {
                sessions.push(currentSession);
                currentSession = [sorted[i]];
            } else {
                currentSession.push(sorted[i]);
            }
        }
        sessions.push(currentSession);

        const sessionStats = sessions.map((session) => {
            const duration = session.length > 1
                ? session[session.length - 1].timestamp - session[0].timestamp
                : 0;
            const pages = session.map((p) => p.page);
            const pagesRead = pages.reduce((a, b) => Math.max(a, b)) - pages.reduce((a, b) => Math.min(a, b));
            const pagesPerMin = duration > 0 ? pagesRead / (duration / 60000) : 0;
            return { duration, pagesRead, pagesPerMin };
        });

        const chartData = [];
        let cumTime = 0;
        let prevTimestamp = null;
        sessions.forEach((session, idx) => {
            const start = session[0].timestamp;
            const stats = sessionStats[idx];
            session.forEach((pt, ptIdx) => {
                let timeOnPage = 0;
                if (ptIdx > 0) {
                    timeOnPage = pt.timestamp - session[ptIdx - 1].timestamp;
                } else if (prevTimestamp && pt.timestamp - prevTimestamp < CONFIG.SESSION_GAP_MS) {
                    timeOnPage = pt.timestamp - prevTimestamp;
                }
                const percentComplete = totalPagesInBook ? (pt.page / totalPagesInBook * 100) : null;

                chartData.push({
                    x: cumTime + (pt.timestamp - start),
                    y: pt.page,
                    realTime: pt.timestamp,
                    sessionIdx: idx,
                    sessionPagesPerMin: stats.pagesPerMin,
                    timeOnPage,
                    percentComplete,
                });
                prevTimestamp = pt.timestamp;
            });
            cumTime += (session[session.length - 1].timestamp - start) + CONFIG.GAP_BETWEEN_SESSIONS_MS;
        });

        return { sessions, chartData, sessionStats };
    }

    function calculateStats(sessions, totalPagesInBook) {
        if (!sessions.length) {
            return {
                pages: 0, time: 0, speed: 0, count: 0, currentPage: 0,
                percentComplete: 0, pagesRemaining: 0, estTimeToFinish: 0,
                fastestSessionSpeed: 0, totalPagesInBook,
            };
        }

        let totalTime = 0;
        let minPage = Infinity;
        let maxPage = -Infinity;
        let fastestSpeed = 0;

        sessions.forEach((session) => {
            const dur = session.length > 1
                ? session[session.length - 1].timestamp - session[0].timestamp
                : 0;
            if (dur > 0) {
                totalTime += dur;
                const pages = session.map((p) => p.page);
                const sp = pages.reduce((a, b) => Math.max(a, b)) - pages.reduce((a, b) => Math.min(a, b));
                const spd = sp / (dur / 3600000);
                if (spd > fastestSpeed) fastestSpeed = spd;
            }
            session.forEach((p) => {
                if (p.page < minPage) minPage = p.page;
                if (p.page > maxPage) maxPage = p.page;
            });
        });

        const pagesRead = maxPage - minPage;
        const hours = totalTime / 3600000;
        const speed = hours > 0 ? pagesRead / hours : 0;
        let pct = 0;
        let remaining = 0;
        let est = 0;
        if (totalPagesInBook) {
            pct = (maxPage / totalPagesInBook) * 100;
            remaining = Math.max(0, totalPagesInBook - maxPage);
            if (speed > 0) est = (remaining / speed) * 3600000;
        }

        return {
            pages: pagesRead, time: totalTime, speed, count: sessions.length,
            currentPage: maxPage, percentComplete: pct, pagesRemaining: remaining,
            estTimeToFinish: est, fastestSessionSpeed: fastestSpeed, totalPagesInBook,
        };
    }

    // Aggregate raw samples into per-day pages-read totals, filling in zero-days.
    function calculateDailyPages(data) {
        if (!data || data.length === 0) return { labels: [], pages: [] };

        // Parse YYYY-MM-DD as local time; new Date("YYYY-MM-DD") is interpreted as UTC.
        const localKey = (d) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const parseLocalDate = (s) => {
            const [y, m, d] = s.split("-").map(Number);
            return new Date(y, m - 1, d);
        };

        const sorted = data.slice().sort((a, b) => a.timestamp - b.timestamp);
        const dailyData = {};
        sorted.forEach((pt) => {
            const key = localKey(new Date(pt.timestamp));
            if (!dailyData[key]) {
                dailyData[key] = { min: pt.page, max: pt.page };
            } else {
                if (pt.page < dailyData[key].min) dailyData[key].min = pt.page;
                if (pt.page > dailyData[key].max) dailyData[key].max = pt.page;
            }
        });

        const dates = Object.keys(dailyData).sort();
        if (dates.length === 0) return { labels: [], pages: [] };

        const startDate = parseLocalDate(dates[0]);
        const endDate = parseLocalDate(dates[dates.length - 1]);

        const labels = [];
        const pages = [];
        for (let cur = new Date(startDate); cur <= endDate; cur.setDate(cur.getDate() + 1)) {
            const key = localKey(cur);
            labels.push(`${cur.getMonth() + 1}/${cur.getDate()}`);
            pages.push(dailyData[key] ? dailyData[key].max - dailyData[key].min : 0);
        }
        return { labels, pages };
    }

    function initStatsMode() {
        log("Stats mode initialized");

        // Wipe the page entirely - we are rendering a standalone dashboard.
        document.head.replaceChildren();
        document.body.replaceChildren();
        document.title = "📚 Playbook Analytics";

        const style = document.createElement("style");
        style.textContent = STATS_CSS;
        document.head.appendChild(style);

        let booksData = Storage.getAllBooksData();
        let booksMetadata = Storage.getAllBooksMetadata();
        const bookTitles = Object.keys(booksData);

        if (bookTitles.length === 0) {
            document.body.innerHTML = NO_DATA_HTML;
            return;
        }

        document.body.innerHTML = STATS_HTML;

        const bookSelect = document.getElementById("bookSelect");
        let currentChart = null;
        let dailyChart = null;

        // Rebuild the dropdown from current booksData. Preserves the user's
        // selection if that book still exists; otherwise falls back to the first.
        function populateBookSelect() {
            const previousValue = bookSelect.value;
            const titles = Object.keys(booksData);
            bookSelect.replaceChildren();
            titles.forEach((title) => {
                const opt = document.createElement("option");
                opt.value = title;
                opt.textContent = title;
                bookSelect.appendChild(opt);
            });
            if (titles.includes(previousValue)) {
                bookSelect.value = previousValue;
            }
            return titles;
        }

        populateBookSelect();

        function renderChart(bookTitle) {
            const data = booksData[bookTitle] || [];
            const meta = booksMetadata[bookTitle] || {};
            const { chartData, sessions } = processBookData(data, meta.totalPages);
            const stats = calculateStats(sessions, meta.totalPages);

            const currentPg = stats.currentPage || "-";
            const totalPg = stats.totalPagesInBook || "?";
            document.getElementById("pageProgress").textContent = `${currentPg} / ${totalPg}`;
            document.getElementById("percentComplete").textContent = stats.totalPagesInBook
                ? `${stats.percentComplete.toFixed(1)}%` : "-";
            document.getElementById("pagesRemaining").textContent = stats.totalPagesInBook
                ? stats.pagesRemaining : "-";
            document.getElementById("totalTime").textContent = formatDuration(stats.time);
            document.getElementById("avgSpeed").textContent = stats.speed.toFixed(1);
            document.getElementById("estTimeToFinish").textContent = stats.estTimeToFinish > 0
                ? formatDuration(stats.estTimeToFinish) : "-";
            document.getElementById("fastestSession").textContent = stats.fastestSessionSpeed > 0
                ? `${stats.fastestSessionSpeed.toFixed(1)} p/h` : "-";
            document.getElementById("sessionCount").textContent = stats.count;

            const groups = {};
            chartData.forEach((pt) => {
                if (!groups[pt.sessionIdx]) groups[pt.sessionIdx] = [];
                groups[pt.sessionIdx].push(pt);
            });
            const datasets = Object.keys(groups).map((idx) => {
                const color = SESSION_COLORS[idx % SESSION_COLORS.length];
                return {
                    label: `Session ${parseInt(idx, 10) + 1}`,
                    data: groups[idx],
                    borderColor: color,
                    backgroundColor: color + "40",
                    pointBackgroundColor: color,
                    pointRadius: 4,
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false,
                };
            });

            if (currentChart) currentChart.destroy();
            currentChart = new Chart(document.getElementById("readingChart").getContext("2d"), {
                type: "line",
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "nearest", axis: "x", intersect: false },
                    scales: {
                        x: {
                            type: "linear",
                            title: { display: true, text: "Reading Time", color: "#94a3b8" },
                            ticks: {
                                color: "#94a3b8",
                                callback: (v) => {
                                    const m = Math.floor(v / 60000);
                                    return `${Math.floor(m / 60)}h ${m % 60}m`;
                                },
                            },
                            grid: { color: "#334155" },
                        },
                        y: {
                            title: { display: true, text: "Page", color: "#94a3b8" },
                            ticks: { color: "#94a3b8" },
                            grid: { color: "#334155" },
                        },
                    },
                    plugins: {
                        tooltip: {
                            enabled: true,
                            backgroundColor: "#1e293b",
                            titleColor: "#60a5fa",
                            bodyColor: "#e2e8f0",
                            borderColor: "#475569",
                            borderWidth: 2,
                            padding: { top: 16, bottom: 16, left: 20, right: 20 },
                            titleFont: { size: 18, weight: "bold" },
                            bodyFont: { size: 15 },
                            titleMarginBottom: 12,
                            bodySpacing: 8,
                            boxPadding: 6,
                            callbacks: {
                                title: (c) => `Page ${c[0].raw.y}`,
                                label: (c) => {
                                    const lines = [];
                                    lines.push(`🕐  ${new Date(c.raw.realTime).toLocaleString()}`);
                                    if (c.raw.percentComplete !== null) {
                                        lines.push(`📊  ${c.raw.percentComplete.toFixed(1)}% complete`);
                                    }
                                    if (c.raw.timeOnPage > 0) {
                                        const secs = Math.round(c.raw.timeOnPage / 1000);
                                        const mins = Math.floor(secs / 60);
                                        const remSecs = secs % 60;
                                        const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;
                                        lines.push(`⏱️  ${timeStr} on page`);
                                    }
                                    if (c.raw.sessionPagesPerMin) {
                                        lines.push(`⚡  ${c.raw.sessionPagesPerMin.toFixed(2)} pages/min`);
                                    }
                                    return lines;
                                },
                            },
                        },
                        legend: { display: false },
                        zoom: {
                            pan: { enabled: true, mode: "xy", modifierKey: null },
                            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "xy" },
                        },
                    },
                },
            });

            const daily = calculateDailyPages(data);
            if (dailyChart) dailyChart.destroy();
            dailyChart = new Chart(document.getElementById("dailyChart").getContext("2d"), {
                type: "bar",
                data: {
                    labels: daily.labels,
                    datasets: [{
                        label: "Pages Read",
                        data: daily.pages,
                        backgroundColor: daily.pages.map((p) => p > 0 ? "#60a5fa" : "#334155"),
                        borderColor: daily.pages.map((p) => p > 0 ? "#3b82f6" : "#475569"),
                        borderWidth: 1,
                        borderRadius: 4,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            title: { display: true, text: "Date", color: "#94a3b8" },
                            ticks: { color: "#94a3b8", maxRotation: 45, minRotation: 45 },
                            grid: { color: "#334155" },
                        },
                        y: {
                            title: { display: true, text: "Pages", color: "#94a3b8" },
                            ticks: { color: "#94a3b8" },
                            grid: { color: "#334155" },
                            beginAtZero: true,
                        },
                    },
                    plugins: {
                        tooltip: {
                            enabled: true,
                            backgroundColor: "#1e293b",
                            titleColor: "#60a5fa",
                            bodyColor: "#e2e8f0",
                            borderColor: "#475569",
                            borderWidth: 1,
                            padding: 12,
                            callbacks: { label: (c) => `${c.raw} pages` },
                        },
                        legend: { display: false },
                    },
                },
            });
        }

        bookSelect.addEventListener("change", () => renderChart(bookSelect.value));

        document.getElementById("refreshData").addEventListener("click", () => {
            booksData = Storage.getAllBooksData();
            booksMetadata = Storage.getAllBooksMetadata();
            const titles = populateBookSelect();
            if (titles.length === 0) {
                document.body.innerHTML = NO_DATA_HTML;
                return;
            }
            renderChart(bookSelect.value);
            const btn = document.getElementById("refreshData");
            btn.textContent = "✅ Updated!";
            setTimeout(() => { btn.textContent = "🔄 Refresh"; }, 1500);
        });

        document.getElementById("resetZoom").addEventListener("click", () => {
            if (currentChart) currentChart.resetZoom();
        });

        document.getElementById("deleteBook").addEventListener("click", () => {
            if (confirm(`Delete "${bookSelect.value}"?`)) {
                Storage.deleteBook(bookSelect.value);
                location.reload();
            }
        });

        document.getElementById("deleteAll").addEventListener("click", () => {
            if (confirm("Delete ALL data?")) {
                Storage.deleteAll();
                location.reload();
            }
        });

        renderChart(bookTitles[0]);
    }

    // ===== Reader mode =====
    // Runs on the Play Books reader. Watches URL changes for page transitions
    // and persists samples to GM storage.

    function initReaderMode() {
        log("Reader mode initialized");

        let lastPage = null;
        let currentBookTitle = null;

        function getBookTitle() {
            const pageTitle = document.title;
            if (pageTitle && pageTitle !== "Google Play Books") {
                const trimmed = pageTitle.replace(/ - Google Play Books$/, "").trim();
                if (trimmed) return trimmed;
            }
            const urlMatch = window.location.href.match(/[?&]id=([^&]+)/);
            if (urlMatch) return `Book_${urlMatch[1]}`;
            return "Unknown Book";
        }

        function getCurrentPage() {
            const match = window.location.href.match(/pg=GBS\.PA(\d+)/);
            return match ? parseInt(match[1], 10) : null;
        }

        function getTotalPages() {
            const extractTotal = (text) => {
                if (!text) return null;
                const slashPattern = text.match(/(\d+)(?:[–\-](\d+))?\s*\/\s*(\d+)/);
                if (slashPattern) return parseInt(slashPattern[3], 10);
                const ofPattern = text.match(/(?:page\s+)?(\d+)\s+of\s+(\d+)/i);
                if (ofPattern) return parseInt(ofPattern[2], 10);
                return null;
            };

            const fromBody = extractTotal(document.body.innerText || "");
            if (fromBody) return fromBody;

            for (const el of document.querySelectorAll("[aria-label], [title]")) {
                const fromAria = extractTotal(el.getAttribute("aria-label"));
                if (fromAria) return fromAria;
                const fromTitle = extractTotal(el.getAttribute("title"));
                if (fromTitle) return fromTitle;
            }

            for (const iframe of document.querySelectorAll("iframe")) {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!doc || !doc.body) continue;
                    const fromIframeBody = extractTotal(doc.body.innerText || "");
                    if (fromIframeBody) return fromIframeBody;
                    for (const el of doc.querySelectorAll("[aria-label]")) {
                        const fromIframeAria = extractTotal(el.getAttribute("aria-label"));
                        if (fromIframeAria) return fromIframeAria;
                    }
                } catch (_) { /* cross-origin */ }
            }

            const urlMatch = window.location.href.match(/[?&]total=(\d+)/);
            if (urlMatch) return parseInt(urlMatch[1], 10);

            return null;
        }

        function trackPageChange() {
            const page = getCurrentPage();
            if (page === null) return;

            if (!currentBookTitle) currentBookTitle = getBookTitle();

            if (page !== lastPage) {
                lastPage = page;
                const data = Storage.getBookData(currentBookTitle);
                data.push({ page, timestamp: Date.now() });
                Storage.saveBookData(currentBookTitle, data);
            }

            const totalPages = getTotalPages();
            if (totalPages) {
                const meta = Storage.getBookMetadata(currentBookTitle);
                if (!meta.totalPages || totalPages > meta.totalPages) {
                    Storage.saveBookMetadata(currentBookTitle, { totalPages });
                }
            }
        }

        function onNavigation() {
            // Title may have changed (different book) - re-detect lazily.
            currentBookTitle = null;
            trackPageChange();
        }

        // Watch for SPA navigation. Play Books mutates the URL via the History API,
        // so plain popstate is not enough - we also wrap pushState/replaceState.
        window.addEventListener("popstate", onNavigation);
        window.addEventListener("hashchange", onNavigation);
        const originalPushState = history.pushState;
        history.pushState = function () {
            originalPushState.apply(this, arguments);
            onNavigation();
        };
        const originalReplaceState = history.replaceState;
        history.replaceState = function () {
            originalReplaceState.apply(this, arguments);
            onNavigation();
        };

        // Listen for total-page hints from the books.googleusercontent.com iframe.
        window.addEventListener("message", (event) => {
            if (event.origin !== IFRAME_ORIGIN) return;
            if (!event.data || event.data.type !== "GPB_TOTAL_PAGES" || !event.data.totalPages) return;
            const title = getBookTitle();
            const meta = Storage.getBookMetadata(title);
            if (!meta.totalPages || event.data.totalPages !== meta.totalPages) {
                Storage.saveBookMetadata(title, { totalPages: event.data.totalPages });
            }
        });

        // Initial sample plus a low-frequency safety net for any URL change the
        // History hooks somehow miss.
        trackPageChange();
        setInterval(trackPageChange, CONFIG.TRACK_INTERVAL_MS);

        // ----- Menu commands -----

        GM_registerMenuCommand("📊 Open Playbook Analytics", () => {
            GM_openInTab("https://example.com/playlytics", { active: true });
        });

        GM_registerMenuCommand("🗑️ Delete Current Book Data", () => {
            const title = getBookTitle();
            if (confirm(`Delete all reading data for "${title}"?`)) {
                Storage.deleteBook(title);
                alert("Data deleted!");
            }
        });

        GM_registerMenuCommand("⚠️ Delete All Reading Data", () => {
            if (confirm("DELETE ALL reading data for ALL books? This cannot be undone!")) {
                Storage.deleteAll();
                alert("All reading data deleted!");
            }
        });
    }

    // ===== Mode dispatch =====
    // Must run AFTER all const declarations above so the init functions can
    // safely reference them (const has a temporal dead zone, unlike var).

    function getMode() {
        const hostname = window.location.hostname;
        if (hostname === "books.googleusercontent.com") return MODES.IFRAME;
        if (hostname === "example.com") return MODES.STATS;
        if (hostname === "play.google.com") return MODES.READER;
        return MODES.UNKNOWN;
    }

    switch (getMode()) {
        case MODES.IFRAME: initIframeMode(); break;
        case MODES.STATS:  initStatsMode();  break;
        case MODES.READER: initReaderMode(); break;
    }

})();
