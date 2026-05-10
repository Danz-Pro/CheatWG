/*
════════════════════════════════════════════════════════════════════
  CheatWG v5.0 — Wayground Join Code Game Helper
  https://github.com/Danz-Pro/CheatWG

  STRATEGY: Proceed API — Direct Answer Extraction
  ═══ VERIFIED FINDINGS ═══
  • Proceed API: POST /_gameapi/main/public/v1/games/{roomHash}/proceed
  • Returns correct answers — does NOT affect game state when called via fetch()
  • MCQ:  structure.answer = number       → data-cy="option-N"
  • MSQ:  structure.answer = [numbers]    → each → data-cy="option-N"
  • BLANK: structure.answer = [{optionId:[ids], targetId}]
          structure.options = [{id, text}] → match optionId to get text
  • data-cy="option-N" uses ORIGINAL API index (NOT affected by jumble)
  • quizId is UNDEFINED in join mode — Proceed API is the ONLY way
════════════════════════════════════════════════════════════════════
*/

// ═══════════════════════════════════════════
//  CACHED ANSWER TYPE
// ═══════════════════════════════════════════

interface CachedAnswer {
  questionId: string;
  type: string;
  /** MCQ/MSQ: correct option indices (0-based, matches data-cy) */
  indices: number[];
  /** Text of correct options for display & fallback matching */
  displayTexts: string[];
  /** BLANK: correct answer text */
  blankText: string;
}

// ═══════════════════════════════════════════
//  THEME — Black & Navy VVIP
// ═══════════════════════════════════════════

const T = {
  bg:          "rgba(8, 10, 28, 0.96)",
  bgGradient:  "linear-gradient(160deg, rgba(13,17,55,0.98), rgba(5,5,20,0.98))",
  navy:        "#0d1137",
  navyLight:   "#1a237e",
  navyGlow:    "#3949ab",
  accent:      "#7c4dff",
  accentDim:   "rgba(124,77,255,0.15)",
  gold:        "#ffd54f",
  goldDim:     "rgba(255,213,79,0.12)",
  goldGlow:    "rgba(255,213,79,0.4)",
  red:         "#ff5252",
  text:        "#e8eaf6",
  textMuted:   "#9fa8da",
  textDim:     "#5c6bc0",
  border:      "rgba(26,35,126,0.5)",
  borderAccent:"rgba(124,77,255,0.4)",
  shadow:      "0 8px 40px rgba(0,0,0,0.7), 0 0 30px rgba(13,17,55,0.3)",
  dimOpacity:  "18%",
  radius:      "12px",
};

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════

const S = {
  answers: new Map<string, CachedAnswer>(),
  currentQId: "",
  pollTimer: null as ReturnType<typeof setInterval> | null,
  panel: null as HTMLElement | null,
  style: null as HTMLElement | null,
  inGame: false,
  totalQ: 0,
  dimWrong: true,
  debug: false,
  lastHighlightQId: "",
  roomHash: "",
  quizVersionId: "",
  playerId: "",
  fetching: new Set<string>(),
};

// ═══════════════════════════════════════════
//  LOG
// ═══════════════════════════════════════════

const LOG = {
  info:    (m: string) => S.debug && console.log(`%c[CheatWG]%c ${m}`, "color:#7c4dff;font-weight:bold", "color:inherit"),
  warn:    (m: string) => console.warn(`%c[CheatWG]%c ${m}`, "color:#ffd54f;font-weight:bold", "color:inherit"),
  error:   (m: string) => console.error(`%c[CheatWG]%c ${m}`, "color:#ff5252;font-weight:bold", "color:inherit"),
  success: (m: string) => console.log(`%c[CheatWG]%c ${m}`, "color:#00e676;font-weight:bold", "color:inherit"),
  always:  (m: string) => console.log(`%c[CheatWG]%c ${m}`, "color:#7c4dff;font-weight:bold", "color:inherit"),
};

// ═══════════════════════════════════════════
//  PINIA ACCESS
// ═══════════════════════════════════════════

const Pinia = {
  _get(): any {
    try {
      const root = document.querySelector("#root") || document.querySelector("#app");
      if (!root) return null;
      const app = (root as any).__vue_app__;
      if (!app) return null;
      return app.config.globalProperties?.$pinia || null;
    } catch { return null; }
  },

  store(name: string): any {
    const p = this._get();
    return p?._s?.get(name) || null;
  },

  state(name: string): any {
    const store = this.store(name);
    return store?.$state || null;
  },

  get roomHash(): string   { return this.state("gameData")?.roomHash || ""; },
  get quizVersionId(): string { return this.state("gameData")?.quizVersionId || ""; },
  get totalQuestions(): number { return this.state("gameData")?.totalQuestionsInQuiz || 0; },

  get currentQId(): string {
    const gq = this.state("gameQuestions");
    return gq?.currentId || gq?.currentQuestionId || "";
  },

  get inGame(): boolean {
    const gd = this.state("gameData");
    return !!(gd?.roomHash && gd?.gameState);
  },

  get playerId(): string {
    return this.state("player")?.playerId || "";
  },

  getQuestion(qId: string): any  { return this.state("gameQuestions")?.list?.[qId] || null; },
  getType(qId: string): string   { return this.getQuestion(qId)?.type || "MCQ"; },
  getText(qId: string): string   { return this.getQuestion(qId)?.text || ""; },
  getOptions(qId: string): any[] { return this.getQuestion(qId)?.options || []; },
  getAnswer(qId: string): any    { return this.getQuestion(qId)?.answer; },
  getState(qId: string): string  { return this.getQuestion(qId)?.state || ""; },
  getTargets(qId: string): any[] { return this.getQuestion(qId)?.targets || []; },
  get doneOrder(): string[]      { return this.state("gameQuestions")?.doneOrder || []; },
};

// ═══════════════════════════════════════════
//  HTML UTIL
// ═══════════════════════════════════════════

const stripHtml = (html: string): string => {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || d.innerText || "").trim();
};

// ═══════════════════════════════════════════
//  PROCEED API — CORRECT ANSWER EXTRACTOR
// ═══════════════════════════════════════════

const API = {
  /** Build the base response body common to all question types */
  _baseBody(questionId: string, questionType: string): any {
    return {
      roomHash: S.roomHash,
      playerId: S.playerId,
      response: {
        attempt: 0,
        questionId,
        questionType,
        responseType: "original",
        timeTaken: 2000 + Math.floor(Math.random() * 4000),
        answer: [],
        isEvaluated: false,
        state: "attempted",
        provisional: {
          scores: { correct: 600, incorrect: 0 },
          scoreBreakups: {
            correct: { base: 600, timer: 0, streak: 0, total: 600, powerups: [] },
            incorrect: { base: 0, timer: 0, streak: 0, total: 0, powerups: [] },
          },
          teamAdjustments: { correct: 0, incorrect: 0 },
        },
      },
      questionId,
      powerupEffects: { destroy: [] },
      quizVersionId: S.quizVersionId,
      elapsed: 0,
      isLastPlayerResponse: false,
    };
  },

  /** Build body for MCQ question */
  buildBodyMCQ(questionId: string): any {
    const body = this._baseBody(questionId, "MCQ");
    body.response.response = 0; // Dummy answer: first option
    return body;
  },

  /** Build body for MSQ question */
  buildBodyMSQ(questionId: string): any {
    const body = this._baseBody(questionId, "MSQ");
    body.response.response = [0]; // Dummy answer: first option
    return body;
  },

  /** Build body for BLANK question */
  buildBodyBLANK(questionId: string): any {
    const targets = Pinia.getTargets(questionId);
    const targetId = targets?.[0]?.id || "";
    const body = this._baseBody(questionId, "BLANK");
    body.response.response = { media: null };
    body.response.answer = [{
      type: "BlankTargetObject",
      value: [{ targetId, value: { text: "x" } }],
      descriptor: "Answer",
    }];
    return body;
  },

  /** Fetch correct answer from Proceed API */
  async fetchAnswer(questionId: string): Promise<{ answer: any; options?: any[] } | null> {
    if (S.fetching.has(questionId)) return null;
    S.fetching.add(questionId);

    const qType = Pinia.getType(questionId);
    let body: any;

    if (qType === "MSQ") {
      body = this.buildBodyMSQ(questionId);
    } else if (qType === "BLANK" || qType === "OPEN") {
      body = this.buildBodyBLANK(questionId);
    } else {
      // MCQ, IS, ORDER, and fallback
      body = this.buildBodyMCQ(questionId);
    }

    try {
      LOG.info(`Proceed API → ${questionId} (${qType})`);

      const r = await fetch(
        `/_gameapi/main/public/v1/games/${S.roomHash}/proceed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!r.ok) {
        LOG.warn(`Proceed API: HTTP ${r.status}`);
        return null;
      }

      const d = await r.json();
      if (!d?.success) {
        LOG.warn(`Proceed API: not success`);
        return null;
      }

      const answer = d?.data?.question?.structure?.answer;
      const options = d?.data?.question?.structure?.options;

      if (answer !== undefined && answer !== null) {
        LOG.success(`Proceed API: answer = ${JSON.stringify(answer)}`);
        return { answer, options };
      }

      LOG.warn(`Proceed API: no answer in response`);
      return null;
    } catch (e: any) {
      LOG.error(`Proceed API error: ${e.message}`);
      return null;
    } finally {
      S.fetching.delete(questionId);
    }
  },

  /** Process the raw API answer into a CachedAnswer */
  processAnswer(questionId: string, apiAnswer: any, apiOptions?: any[]): CachedAnswer {
    const qType = Pinia.getType(questionId);
    const piniaOptions = Pinia.getOptions(questionId);

    const cached: CachedAnswer = {
      questionId,
      type: qType,
      indices: [],
      displayTexts: [],
      blankText: "",
    };

    if (qType === "MCQ" || qType === "IS" || qType === "ORDER") {
      // MCQ: answer is a number (0-based index)
      if (typeof apiAnswer === "number" && apiAnswer >= 0) {
        cached.indices.push(apiAnswer);
      }
      // Build display texts from Pinia options
      cached.indices.forEach(idx => {
        if (idx < piniaOptions.length) {
          const txt = stripHtml(piniaOptions[idx].text || "");
          if (txt) cached.displayTexts.push(txt);
        }
      });

    } else if (qType === "MSQ") {
      // MSQ: answer is array of numbers
      if (Array.isArray(apiAnswer)) {
        apiAnswer.forEach((idx: number) => {
          if (typeof idx === "number" && idx >= 0) cached.indices.push(idx);
        });
      }
      cached.indices.forEach(idx => {
        if (idx < piniaOptions.length) {
          const txt = stripHtml(piniaOptions[idx].text || "");
          if (txt) cached.displayTexts.push(txt);
        }
      });

    } else if (qType === "BLANK" || qType === "OPEN") {
      // BLANK: answer is [{optionId: [ids], targetId: string}]
      if (Array.isArray(apiAnswer) && apiAnswer.length > 0 && typeof apiAnswer[0] === "object") {
        // Collect all optionIds from answer
        const optionIds: string[] = [];
        apiAnswer.forEach((a: any) => {
          if (a.optionId && Array.isArray(a.optionId)) {
            a.optionId.forEach((oid: string) => optionIds.push(oid));
          }
        });

        // Try to match optionIds to API options first (most reliable)
        if (apiOptions && Array.isArray(apiOptions)) {
          apiOptions.forEach((opt: any) => {
            if (optionIds.includes(opt.id || opt._id)) {
              const txt = stripHtml(opt.text || "");
              if (txt) {
                cached.blankText = txt;
                cached.displayTexts.push(txt);
              }
            }
          });
        }

        // Fallback: match to Pinia options
        if (!cached.blankText && piniaOptions.length > 0) {
          const optMap = new Map<string, string>();
          piniaOptions.forEach((o: any) => {
            if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text));
          });
          optionIds.forEach(oid => {
            const txt = optMap.get(oid);
            if (txt) { cached.blankText = txt; cached.displayTexts.push(txt); }
          });
        }
      }
    }

    S.answers.set(questionId, cached);
    return cached;
  },

  /** Fetch and process answer for a question */
  async fetchAndProcess(questionId: string): Promise<CachedAnswer | null> {
    // Check if already cached
    const existing = S.answers.get(questionId);
    if (existing && (existing.indices.length > 0 || existing.blankText)) {
      return existing;
    }

    // WORDCLOUD has no correct answer
    const qType = Pinia.getType(questionId);
    if (qType === "WORDCLOUD") {
      LOG.info(`WORDCLOUD — no correct answer`);
      return null;
    }

    const result = await this.fetchAnswer(questionId);
    if (result) {
      return this.processAnswer(questionId, result.answer, result.options);
    }
    return null;
  },
};

// ═══════════════════════════════════════════
//  DOM — OPTION SELECTION & HIGHLIGHTING
// ═══════════════════════════════════════════

const DOM = {
  /** Get all option elements on screen */
  getOptions(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  },

  /** Get option by API index — uses data-cy which is NOT shuffled */
  getOptionByIndex(idx: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-cy="option-${idx}"]`);
  },

  /** Get BLANK text input */
  getBlankTextInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('[data-cy="fib-text-input"]')
      || document.querySelector<HTMLInputElement>('input.fib-text-input');
  },

  /** Get BLANK box inputs (character-by-character) */
  getBlankBoxInputs(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input.fib-box-input'));
  },

  /** Clear all highlights */
  clearHighlights(): void {
    document.querySelectorAll<HTMLElement>("[data-wg-correct], [data-wg-wrong]").forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.style.opacity = "";
      el.style.transition = "";
      el.style.boxShadow = "";
      el.style.transform = "";
      el.style.background = "";
      el.removeAttribute("data-wg-correct");
      el.removeAttribute("data-wg-wrong");
    });
  },

  /** Highlight a correct option with gold VVIP style */
  highlightCorrect(el: HTMLElement): void {
    el.style.outline = `2px solid ${T.gold}`;
    el.style.outlineOffset = "1px";
    el.style.boxShadow = `0 0 20px ${T.goldGlow}, inset 0 0 12px ${T.goldDim}`;
    el.style.transition = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.transform = "scale(1.04)";
    el.style.background = `linear-gradient(135deg, ${T.goldDim}, transparent)`;
    el.setAttribute("data-wg-correct", "1");
  },

  /** Dim a wrong option */
  dimWrong(el: HTMLElement): void {
    el.style.opacity = T.dimOpacity;
    el.style.transition = "opacity 0.4s ease";
    el.setAttribute("data-wg-wrong", "1");
  },

  /** Fill BLANK text input */
  fillBlankText(text: string): boolean {
    const input = this.getBlankTextInput();
    if (!input) return false;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, text); else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    LOG.success(`Filled blank: "${text}"`);
    return true;
  },

  /** Fill BLANK box inputs (character-by-character) */
  fillBlankBoxes(text: string, qId?: string): boolean {
    const inputs = this.getBlankBoxInputs();
    if (inputs.length === 0) return false;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;

    // Get special indices (characters that should be skipped/pre-filled)
    let specialIndices: number[] = [];
    if (qId) {
      const targets = Pinia.getTargets(qId);
      targets?.forEach((t: any) => {
        if (t.settings?.specialIndices) {
          t.settings.specialIndices.forEach((si: any) => {
            if (typeof si.index === "number") specialIndices.push(si.index);
          });
        }
      });
    }

    let charIdx = 0;
    for (let boxIdx = 0; boxIdx < inputs.length && charIdx < text.length; boxIdx++) {
      // Skip special indices
      while (specialIndices.includes(charIdx) && charIdx < text.length) {
        charIdx++;
      }
      if (charIdx < text.length) {
        setter.call(inputs[boxIdx], text[charIdx]);
        inputs[boxIdx].dispatchEvent(new Event("input", { bubbles: true }));
        charIdx++;
      }
    }
    LOG.success(`Filled blank boxes: "${text}" (${inputs.length} boxes)`);
    return true;
  },
};

// ═══════════════════════════════════════════
//  ENGINE — CORE LOGIC
// ═══════════════════════════════════════════

const Engine = {
  /** Highlight correct answers in the DOM */
  highlightAnswer(cached: CachedAnswer): boolean {
    // BLANK / OPEN: fill the input
    if (cached.type === "BLANK" || cached.type === "OPEN") {
      if (!cached.blankText) return false;
      const filled = DOM.fillBlankBoxes(cached.blankText, cached.questionId)
                   || DOM.fillBlankText(cached.blankText);
      return filled;
    }

    // MCQ / MSQ / IS / ORDER: highlight options
    const allOptions = DOM.getOptions();
    if (allOptions.length === 0) return false;

    const correctEls: HTMLElement[] = [];

    // METHOD 1: data-cy="option-N" — BULLETPROOF, not affected by shuffle
    for (const idx of cached.indices) {
      const el = DOM.getOptionByIndex(idx);
      if (el) {
        correctEls.push(el);
        LOG.info(`Found option-${idx} via data-cy`);
      }
    }

    // METHOD 2: Text fallback (if data-cy didn't work)
    if (correctEls.length === 0 && cached.displayTexts.length > 0) {
      allOptions.forEach((el) => {
        const elText = stripHtml(el.textContent || "").toLowerCase();
        for (const ct of cached.displayTexts) {
          const ctLower = ct.toLowerCase();
          if (elText === ctLower || elText.includes(ctLower) || ctLower.includes(elText)) {
            correctEls.push(el);
            break;
          }
        }
      });
    }

    // Apply highlights
    if (correctEls.length > 0) {
      const correctSet = new Set(correctEls);
      allOptions.forEach((el) => {
        if (correctSet.has(el)) DOM.highlightCorrect(el);
        else if (S.dimWrong) DOM.dimWrong(el);
      });
      LOG.success(`Highlighted ${correctEls.length} correct / ${allOptions.length} total`);
      return true;
    }

    LOG.warn(`Could not match any correct option in DOM`);
    return false;
  },

  /** Process a question: fetch answer + highlight */
  async processQuestion(qId: string): Promise<boolean> {
    // Check cache first
    const cached = S.answers.get(qId);
    if (cached && (cached.indices.length > 0 || cached.blankText)) {
      DOM.clearHighlights();
      this.updatePanel(qId, cached);
      const success = this.highlightAnswer(cached);
      if (success) S.lastHighlightQId = qId;
      return success;
    }

    Panel.updateStatus("Mengambil jawaban...", "loading");

    const result = await API.fetchAndProcess(qId);

    if (result) {
      DOM.clearHighlights();
      this.updatePanel(qId, result);
      const success = this.highlightAnswer(result);
      if (success) S.lastHighlightQId = qId;
      Panel.updateStatus("Jawaban ditemukan!", "ok");
      return success;
    }

    const qType = Pinia.getType(qId);
    if (qType === "WORDCLOUD") {
      Panel.updateStatus("WORDCLOUD — tidak ada jawaban benar", "loading");
      return true;
    }

    Panel.updateStatus("Gagal mengambil jawaban", "err");
    return false;
  },

  /** Update the panel display */
  updatePanel(qId: string, cached: CachedAnswer): void {
    const qText = stripHtml(Pinia.getText(qId));
    const type = Pinia.getType(qId);

    let answerDisplay = "—";
    if (cached.blankText) {
      answerDisplay = cached.blankText;
    } else if (cached.displayTexts.length > 0) {
      answerDisplay = cached.displayTexts.join(" / ");
    } else if (cached.indices.length > 0) {
      answerDisplay = `Opsi ${cached.indices.map(i => `#${i + 1}`).join(", ")}`;
    }

    Panel.updateQuestion(qText, type);
    Panel.updateAnswer(answerDisplay);
  },

  /** Main tick — check for question change */
  async tick(): Promise<void> {
    if (!Pinia.inGame) {
      if (S.inGame) this.stop();
      return;
    }

    // Detect game start
    if (!S.inGame) {
      S.inGame = true;
      S.roomHash = Pinia.roomHash;
      S.quizVersionId = Pinia.quizVersionId;
      S.playerId = Pinia.playerId;
      S.totalQ = Pinia.totalQuestions;

      LOG.always(`Game detected! Room: ${S.roomHash}, Player: ${S.playerId}, Questions: ${S.totalQ}`);
      Panel.updateStats();
    }

    const qId = Pinia.currentQId;
    if (!qId || qId === S.currentQId) return;

    S.currentQId = qId;
    LOG.info(`New question: ${qId} (${Pinia.getType(qId)})`);

    await this.processQuestion(qId);
    Panel.updateStats();
  },

  /** Start polling */
  startPolling(): void {
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(() => this.tick(), 300);
    this.setupDOMWatcher();
  },

  /** Watch for DOM mutations that remove highlights */
  setupDOMWatcher(): void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let reapplyCount = 0;

    const observer = new MutationObserver((mutations) => {
      if (!S.lastHighlightQId || !Pinia.inGame) return;

      const cached = S.answers.get(S.lastHighlightQId);
      if (cached && (cached.type === "BLANK" || cached.type === "OPEN")) return;

      const relevant = mutations.some((m) => {
        if (m.type === "attributes" && m.attributeName === "class") {
          const target = m.target as HTMLElement;
          return target.hasAttribute?.("role") && target.getAttribute("role") === "option";
        }
        return m.type === "childList";
      });

      if (!relevant) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!document.querySelector("[data-wg-correct]") && reapplyCount < 5) {
          reapplyCount++;
          S.lastHighlightQId = "";
          const qId = Pinia.currentQId;
          if (qId) this.processQuestion(qId);
        }
      }, 300);
    });

    // Reset reapply counter on question change
    const originalTick = this.tick.bind(this);
    this.tick = async () => { reapplyCount = 0; await originalTick(); };

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  },

  /** Stop everything */
  stop(): void {
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
    DOM.clearHighlights();
    S.inGame = false;
    S.answers.clear();
    S.currentQId = "";
    S.lastHighlightQId = "";
    S.totalQ = 0;
  },
};

// ═══════════════════════════════════════════
//  PANEL — VVIP FLOATING UI
// ═══════════════════════════════════════════

const Panel = {
  create(): void {
    if (S.panel) return;

    const el = document.createElement("div");
    el.id = "wg-panel";
    el.classList.add("ghost"); // Start in ghost mode
    el.innerHTML = `
      <div id="wg-header">
        <div id="wg-logo"><span id="wg-logo-sub">ELITE</span></div>
        <div id="wg-header-actions">
          <button id="wg-btn-reload" title="Muat ulang jawaban">&#x21bb;</button>
          <button id="wg-btn-minimize" title="Perkecil">&#x2500;</button>
        </div>
      </div>
      <div id="wg-body">
        <div id="wg-status"><span id="wg-status-dot"></span><span id="wg-status-text">Memulai...</span></div>
        <div id="wg-question"></div>
        <div id="wg-answer"></div>
        <div id="wg-divider"></div>
        <div id="wg-controls">
          <label class="wg-toggle">
            <input type="checkbox" id="wg-dim" checked />
            <span class="wg-slider"></span>
            <span class="wg-label">Redupkan Salah</span>
          </label>
          <label class="wg-toggle">
            <input type="checkbox" id="wg-debug" />
            <span class="wg-slider"></span>
            <span class="wg-label">Debug</span>
          </label>
        </div>
        <div id="wg-stats"></div>
      </div>
    `;

    const style = document.createElement("style");
    style.id = "wg-css";
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      #wg-panel { position:fixed;top:12px;right:12px;z-index:999999;font-family:'Inter',-apple-system,system-ui,sans-serif;font-size:13px;color:${T.text};background:${T.bgGradient};border:1px solid ${T.border};border-radius:${T.radius};width:280px;box-shadow:${T.shadow};backdrop-filter:blur(20px);user-select:none;overflow:hidden;transition:opacity 0.4s ease,box-shadow 0.4s ease;animation:wgSlideIn 0.4s cubic-bezier(0.4,0,0.2,1); }
      #wg-panel.ghost { width:auto;border-radius:8px;background:none!important;backdrop-filter:none!important;box-shadow:none!important;border:none!important; }
      #wg-panel.ghost #wg-body { display:none; }
      #wg-panel.ghost #wg-logo { display:none; }
      #wg-panel.ghost #wg-btn-reload { display:none; }
      #wg-panel.ghost #wg-header { padding:0;background:none!important;border-bottom:none!important;border-radius:8px;margin:0; }
      #wg-panel.ghost #wg-header-actions { gap:0;background:none!important; }
      #wg-panel.ghost #wg-btn-minimize { opacity:0.4;border:none!important;font-size:14px;padding:4px 10px;background:none!important;color:rgba(100,100,100,0.9);border-radius:8px;pointer-events:auto;cursor:pointer;outline:none; }
      #wg-panel.ghost #wg-btn-minimize:hover { opacity:1;color:rgba(60,60,60,1); }
      #wg-panel:not(.ghost) { width:280px;pointer-events:auto; }
      @keyframes wgSlideIn { from{opacity:0;transform:translateY(-20px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
      #wg-header { display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,${T.navyLight}44,${T.navy}22);border-bottom:1px solid ${T.border}; }
      #wg-logo { display:flex;align-items:baseline;gap:5px; }
      #wg-logo-sub { font-weight:800;font-size:16px;color:${T.gold};letter-spacing:5px;text-shadow:0 0 12px ${T.gold}80; }
      #wg-header-actions { display:flex;gap:4px; }
      #wg-header-actions button { background:none;border:1px solid ${T.border};color:${T.textDim};cursor:pointer;font-size:12px;padding:2px 8px;border-radius:6px;transition:all 0.2s;line-height:1.2; }
      #wg-header-actions button:hover { color:${T.accent};border-color:${T.borderAccent};background:${T.accentDim}; }
      #wg-body { padding:12px 14px; }
      #wg-status { display:flex;align-items:center;gap:8px;margin-bottom:8px; }
      #wg-status-dot { width:7px;height:7px;border-radius:50%;background:#555;flex-shrink:0;transition:background 0.3s; }
      #wg-status.ok #wg-status-dot { background:#00e676;box-shadow:0 0 8px #00e67666; }
      #wg-status.err #wg-status-dot { background:${T.red};box-shadow:0 0 8px ${T.red}66; }
      #wg-status.loading #wg-status-dot { background:${T.gold};animation:wgPulse 1s infinite; }
      @keyframes wgPulse { 0%,100%{opacity:1}50%{opacity:0.3} }
      #wg-status-text { font-size:11px;color:${T.textDim}; }
      #wg-question { font-size:11px;color:${T.textMuted};margin-bottom:6px;max-height:40px;overflow:hidden;line-height:1.4; }
      #wg-answer { font-size:14px;font-weight:700;color:${T.gold};margin:8px 0;padding:10px 12px;background:${T.goldDim};border-radius:8px;border-left:3px solid ${T.gold};max-height:80px;overflow-y:auto;word-break:break-word;line-height:1.3; }
      #wg-divider { height:1px;background:${T.border};margin:10px 0; }
      #wg-controls { display:flex;flex-direction:column;gap:6px; }
      .wg-toggle { display:flex;align-items:center;gap:8px;cursor:pointer;font-size:11px;color:${T.textDim}; }
      .wg-toggle input { display:none; }
      .wg-slider { position:relative;width:32px;height:16px;background:${T.navyLight};border-radius:8px;transition:all 0.3s;flex-shrink:0;border:1px solid ${T.border}; }
      .wg-slider::after { content:'';position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:${T.textDim};transition:all 0.3s; }
      .wg-toggle input:checked + .wg-slider { background:${T.accent};border-color:${T.accent}; }
      .wg-toggle input:checked + .wg-slider::after { transform:translateX(16px);background:white; }
      .wg-label { transition:color 0.2s; }
      .wg-toggle:hover .wg-label { color:${T.textMuted}; }
      #wg-stats { font-size:10px;color:${T.textDim};margin-top:8px;display:flex;justify-content:space-between; }
      #wg-answer::-webkit-scrollbar { width:4px; }
      #wg-answer::-webkit-scrollbar-track { background:transparent; }
      #wg-answer::-webkit-scrollbar-thumb { background:${T.navyGlow};border-radius:2px; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(el);
    S.panel = el;
    S.style = style;

    this.setupDrag(el);

    // Minimize / ghost mode toggle
    el.querySelector("#wg-btn-minimize")!.addEventListener("click", () => el.classList.toggle("ghost"));

    // Reload button
    el.querySelector("#wg-btn-reload")!.addEventListener("click", async () => {
      S.fetching.clear();
      const qId = Pinia.currentQId;
      if (qId) {
        S.answers.delete(qId);
        await Engine.processQuestion(qId);
        Panel.updateStats();
      }
    });

    // Dim wrong toggle
    el.querySelector("#wg-dim")!.addEventListener("change", (e) => {
      S.dimWrong = (e.target as HTMLInputElement).checked;
      if (S.lastHighlightQId) {
        S.lastHighlightQId = "";
        const qId = Pinia.currentQId;
        if (qId) Engine.processQuestion(qId);
      }
    });

    // Debug toggle
    el.querySelector("#wg-debug")!.addEventListener("change", (e) => {
      S.debug = (e.target as HTMLInputElement).checked;
    });
  },

  setupDrag(el: HTMLElement): void {
    const header = el.querySelector("#wg-header") as HTMLElement;
    if (!header) return;
    let sx = 0, sy = 0, ix = 0, iy = 0;
    header.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ix = r.left; iy = r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!sx) return;
      el.style.left = `${ix + e.clientX - sx}px`;
      el.style.top = `${iy + e.clientY - sy}px`;
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { sx = 0; sy = 0; });
  },

  updateStatus(text: string, type: "ok" | "err" | "loading" | "") {
    const el = S.panel?.querySelector("#wg-status");
    if (el) { el.className = type; const t = el.querySelector("#wg-status-text"); if (t) t.textContent = text; }
  },

  updateQuestion(text: string, type: string) {
    const el = S.panel?.querySelector("#wg-question");
    if (el) el.textContent = `${text.substring(0, 80)}${text.length > 80 ? "..." : ""} [${type}]`;
  },

  updateAnswer(text: string) {
    const el = S.panel?.querySelector("#wg-answer");
    if (el) el.textContent = text;
  },

  updateStats() {
    const el = S.panel?.querySelector("#wg-stats");
    if (el) {
      const done = Pinia.doneOrder.length;
      const cached = S.answers.size;
      el.innerHTML = `<span>${done}/${S.totalQ} dijawab</span><span>${cached} jawaban</span>`;
    }
  },

  destroy(): void {
    if (S.panel) { S.panel.remove(); S.panel = null; }
    if (S.style) { S.style.remove(); S.style = null; }
  },
};

// ═══════════════════════════════════════════
//  BOOT — MAIN ENTRY POINT
// ═══════════════════════════════════════════

const Boot = {
  async start(): Promise<void> {
    LOG.always("CheatWG v5.0 — Join Mode Helper");

    Panel.create();
    Panel.updateStatus("Menunggu permainan...", "loading");

    // Wait for game to start (up to 60s)
    for (let i = 0; i < 60; i++) {
      if (Pinia.inGame) break;
      await new Promise(r => setTimeout(r, 1000));
      Panel.updateStatus(`Menunggu permainan... (${i + 1}d)`, "loading");
    }

    if (!Pinia.inGame) {
      Panel.updateStatus("Permainan tidak ditemukan", "err");
      return;
    }

    // Capture game info
    S.roomHash = Pinia.roomHash;
    S.quizVersionId = Pinia.quizVersionId;
    S.playerId = Pinia.playerId;
    S.totalQ = Pinia.totalQuestions;
    S.inGame = true;

    LOG.always(`Game: Room=${S.roomHash}, Player=${S.playerId}, Questions=${S.totalQ}`);
    Panel.updateStatus("Siap mengambil jawaban", "ok");
    Panel.updateStats();

    // Start polling
    Engine.startPolling();

    // Process current question immediately
    const qId = Pinia.currentQId;
    if (qId) {
      S.currentQId = qId;
      await Engine.processQuestion(qId);
    }

    LOG.success("CheatWG v5.0 ready!");
  },

  stop(): void {
    Engine.stop();
    Panel.destroy();
  },
};

// ═══════════════════════════════════════════
//  GLOBAL API + AUTO-START
// ═══════════════════════════════════════════

(window as any).CheatWG = {
  start: () => Boot.start(),
  stop: () => Boot.stop(),
  config: {
    get dimWrong() { return S.dimWrong; },
    set dimWrong(v) { S.dimWrong = v; },
    get debug() { return S.debug; },
    set debug(v) { S.debug = v; },
  },
  reload: (qId?: string) => {
    const id = qId || Pinia.currentQId;
    if (id) { S.answers.delete(id); Engine.processQuestion(id); }
  },
  answers: () => S.answers,
};

Boot.start();
