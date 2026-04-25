// ==UserScript==
// @name         Playbook Analytics
// @namespace    https://github.com/Brandon123b/Playbook-Analytics
// @version      0.1.0
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
// @supportURL   https://github.com/Brandon123b/Playbook-Analytics/issues
// @downloadURL  https://raw.githubusercontent.com/Brandon123b/Playbook-Analytics/main/PlaybookAnalytics.user.js
// @updateURL    https://raw.githubusercontent.com/Brandon123b/Playbook-Analytics/main/PlaybookAnalytics.meta.js
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js
// ==/UserScript==
