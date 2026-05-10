// ==UserScript==
// @name         CheatWG
// @namespace    https://github.com/Danz-Pro/CheatWG
// @version      5.0
// @description  Wayground Join Code Game Helper — Proceed API Strategy v5
// @author       Danz-Pro
// @match        https://wayground.com/*
// @match        https://quizizz.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  // Load the bundle
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/gh/Danz-Pro/CheatWG@main/dist/bundle.js';
  script.onload = () => console.log('[CheatWG] v5.0 Script loaded');
  script.onerror = () => console.error('[CheatWG] Failed to load script');
  document.head.appendChild(script);
})();
