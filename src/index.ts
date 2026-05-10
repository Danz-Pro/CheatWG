/*
════════════════════════════════════════════════════════════════════
  CheatWG v3.0 — Wayground Join Code Game Helper
  https://github.com/Danz-Pro/CheatWG

  DEEP ANALYSIS FINDINGS (Join Code Mode):
  ┌─────────────────────────────────────────────────────────────┐
  │ ★ KEY DISCOVERY: Proceed API leaks correct answers! ★      │
  │                                                             │
  │ POST /_gameapi/main/public/v1/games/{roomHash}/proceed     │
  │ → Response: data.question.structure.answer                 │
  │ → Returns correct answer index BEFORE user answers!        │
  │                                                             │
  │ STRATEGY: "Proceed & Highlight"                            │
  │ → For each current question, call Proceed API with         │
  │   a dummy answer to extract the correct answer             │
  │ → Highlight correct option using data-cy attribute         │
  │ → Cache answers for replay                                 │
  │ → Auto-advance handled by game flow                        │
  │                                                             │
  │ Verified facts:                                             │
  │ • quizId = undefined in join mode                          │
  │ • Quiz API unusable, Game API needs auth                   │
  │ • answer = -1 in Pinia before answering                    │
  │ • data-cy="option-N" uses ORIGINAL API index               │
  │ • jumbleAnswers = true, options shuffled on display        │
  │ • redemption = "yes", second attempts allowed              │
  │ • antiCheating.enabled = true (no actual blocking)         │
  │ • roomHash = MongoDB ID, not encrypted URL hash            │
  │ • 15 questions total: MCQ, MSQ, BLANK types                │
  └─────────────────────────────────────────────────────────────┘
════════════════════════════════════════════════════════════════════
*/

// ═══════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════

interface CachedAnswer {
  questionId: string;
  type: string;
  correctIndices: number[];
  displayTexts: string[];
  blankTexts: string[];
  imageUrls: string[];
  fetched: boolean;
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
  redDim:      "rgba(255,82,82,0.15)",
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
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  lastHighlightQId: "",
  roomHash: "",
  roomCode: "",
  playerId: "",
  quizVersionId: "",
  fetchingQId: "",
  initialized: false,
};

// ═══════════════════════════════════════════
//  LOG
// ═══════════════════════════════════════════

const LOG = {
  info: (m: string) => S.debug && console.log(`%c[CheatWG]%c ${m}`, "color:#7c4dff;font-weight:bold", "color:inherit"),
  warn: (m: string) => console.warn(`%c[CheatWG]%c ${m}`, "color:#ffd54f;font-weight:bold", "color:inherit"),
  error: (m: string) => console.error(`%c[CheatWG]%c ${m}`, "color:#ff5252;font-weight:bold", "color:inherit"),
  success: (m: string) => console.log(`%c[CheatWG]%c ${m}`, "color:#00e676;font-weight:bold", "color:inherit"),
  always: (m: string) => console.log(`%c[CheatWG]%c ${m}`, "color:#7c4dff;font-weight:bold", "color:inherit"),
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

  get roomHash(): string { return this.state("gameData")?.roomHash || ""; },
  get roomCode(): string { return this.state("gameData")?.roomCode || ""; },
  get gameState(): string { return this.state("gameData")?.gameState || ""; },
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

  get questionList(): Record<string, any> { return this.state("gameQuestions")?.list || {}; },
  get doneOrder(): string[] { return this.state("gameQuestions")?.doneOrder || []; },
  get questionIds(): string[] { return Object.keys(this.state("gameQuestions")?.list || {}); },

  getQuestion(qId: string): any { return this.questionList?.[qId] || null; },
  getType(qId: string): string { return this.getQuestion(qId)?.type || "MCQ"; },
  getText(qId: string): string { return this.getQuestion(qId)?.text || ""; },
  getOptions(qId: string): any[] { return this.getQuestion(qId)?.options || []; },
  getAnswer(qId: string): any { return this.getQuestion(qId)?.answer; },
  getState(qId: string): string { return this.getQuestion(qId)?.state || ""; },

  get playerId(): string {
    const p = this.state("player");
    return p?.playerId || "";
  },

  get gameOptions(): any {
    return this.state("gameData")?.gameOptions || {};
  },
};

// ═══════════════════════════════════════════
//  HTML UTILITIES
// ═══════════════════════════════════════════

const stripHtml = (html: string): string => {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || d.innerText || "").trim();
};

// ═══════════════════════════════════════════
//  ANSWER CACHE — localStorage persistence
// ═══════════════════════════════════════════

const AnswerCache = {
  KEY: "cheatwg_v3",

  save(roomHash: string): void {
    const data: Record<string, any> = {};
    S.answers.forEach((val, key) => { data[key] = val; });
    try {
      localStorage.setItem(`${this.KEY}_${roomHash}`, JSON.stringify(data));
    } catch { /* ignore */ }
  },

  load(roomHash: string): number {
    try {
      const raw = localStorage.getItem(`${this.KEY}_${roomHash}`);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      let count = 0;
      for (const [qId, ans] of Object.entries(data)) {
        S.answers.set(qId, ans as CachedAnswer);
        count++;
      }
      return count;
    } catch { return 0; }
  },
};

// ═══════════════════════════════════════════
//  PROCEED API — JAWABAN TERUNGKAP!
// ═══════════════════════════════════════════

const ProceedAPI = {
  /**
   * Build the Proceed API request body for a question.
   */
  buildBody(questionId: string, questionType: string): any {
    let response: any = 0;
    if (questionType === "MSQ") response = [0];
    else if (questionType === "BLANK" || questionType === "OPEN") response = "";

    return {
      roomHash: S.roomHash,
      playerId: S.playerId,
      response: {
        attempt: 0,
        questionId: questionId,
        questionType: questionType,
        response: response,
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
      questionId: questionId,
      powerupEffects: { destroy: [] },
      quizVersionId: S.quizVersionId,
      elapsed: 0,
      isLastPlayerResponse: false,
    };
  },

  /**
   * Fetch correct answer for a single question via Proceed API.
   * Returns the correct answer index/indices from data.question.structure.answer.
   * NOTE: Does NOT work for BLANK/OPEN types — use interceptor instead.
   */
  async fetchAnswer(questionId: string): Promise<number | number[] | null> {
    // Prevent duplicate fetches
    if (S.fetchingQId === questionId) return null;
    S.fetchingQId = questionId;

    const qType = Pinia.getType(questionId);

    // BLANK/OPEN types can't use Proceed API — skip
    if (qType === "BLANK" || qType === "OPEN") {
      LOG.info(`Skipping Proceed for ${qType} question ${questionId}`);
      S.fetchingQId = "";
      return null;
    }

    const body = this.buildBody(questionId, qType);

    try {
      const r = await fetch(
        `/_gameapi/main/public/v1/games/${S.roomHash}/proceed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!r.ok) {
        LOG.warn(`Proceed API: HTTP ${r.status} for ${questionId}`);
        return null;
      }

      const d = await r.json();
      if (!d.success) {
        LOG.warn(`Proceed API: not success for ${questionId}`);
        return null;
      }

      const answer = d?.data?.question?.structure?.answer;
      if (answer !== undefined && answer !== null && answer !== -1) {
        LOG.success(`Proceed API: answer for ${questionId} = ${JSON.stringify(answer)}`);
        return answer;
      }

      LOG.warn(`Proceed API: no answer in response for ${questionId}`);
      return null;
    } catch (e: any) {
      LOG.error(`Proceed API error: ${e.message}`);
      return null;
    } finally {
      S.fetchingQId = "";
    }
  },

  /**
   * Process the answer from Proceed API and cache it.
   */
  processAnswer(questionId: string, answer: number | number[] | null): CachedAnswer | null {
    if (answer === null) return null;

    const qType = Pinia.getType(questionId);
    const options = Pinia.getOptions(questionId);

    const cached: CachedAnswer = {
      questionId,
      type: qType,
      correctIndices: [],
      displayTexts: [],
      blankTexts: [],
      imageUrls: [],
      fetched: true,
    };

    if (qType === "MCQ" || qType === "MSQ" || qType === "IS" || qType === "ORDER") {
      // Parse answer indices
      if (typeof answer === "number" && answer >= 0) {
        cached.correctIndices.push(answer);
      } else if (Array.isArray(answer)) {
        answer.forEach((idx: number) => {
          if (typeof idx === "number" && idx >= 0) cached.correctIndices.push(idx);
        });
      }

      // Build display texts from options using API indices
      cached.correctIndices.forEach((idx) => {
        if (idx < options.length) {
          const opt = options[idx];
          const rawText = stripHtml(opt.text || "");
          if (rawText) cached.displayTexts.push(rawText);
          if (opt.media?.[0]?.url) cached.imageUrls.push(opt.media[0].url.split("?")[0]);
        }
      });
    } else if (qType === "BLANK" || qType === "OPEN") {
      if (Array.isArray(answer) && answer.length > 0) {
        if (typeof answer[0] === "object") {
          // BLANK type: answer is array of {targetId, optionId[]}
          const optMap = new Map<string, string>();
          options.forEach((o: any) => {
            if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text));
          });
          (answer as unknown as Array<{targetId: string; optionId: string[]}>).forEach((a) => {
            a.optionId?.forEach((oid) => {
              const txt = optMap.get(oid);
              if (txt) { cached.blankTexts.push(txt); cached.displayTexts.push(txt); }
            });
          });
        } else {
          // OPEN type: answer might be array of strings
          answer.forEach((a: any) => {
            if (typeof a === "string" && a) { cached.blankTexts.push(a); cached.displayTexts.push(a); }
          });
        }
      }
      // Fallback: if no blank texts found, extract from options
      if (cached.blankTexts.length === 0) {
        options.forEach((o: any) => {
          const txt = stripHtml(o.text || "");
          if (txt) { cached.blankTexts.push(txt); cached.displayTexts.push(txt); }
        });
      }
    }

    S.answers.set(questionId, cached);
    return cached;
  },

  /**
   * Fetch answer for current question and process it.
   */
  async fetchAndProcess(questionId: string): Promise<CachedAnswer | null> {
    // Check if already cached
    const existing = S.answers.get(questionId);
    if (existing && existing.fetched && (existing.correctIndices.length > 0 || existing.blankTexts.length > 0)) return existing;

    const qType = Pinia.getType(questionId);

    // For BLANK/OPEN: build a pending cache entry from targets, wait for reveal
    if (qType === "BLANK" || qType === "OPEN") {
      const cached = this.buildBlankEntry(questionId);
      if (cached) {
        S.answers.set(questionId, cached);
        return cached;
      }
      return null;
    }

    const answer = await this.fetchAnswer(questionId);
    return this.processAnswer(questionId, answer);
  },

  /**
   * Build a pending cache entry for BLANK/OPEN questions from targets data.
   */
  buildBlankEntry(questionId: string): CachedAnswer | null {
    const q = Pinia.getQuestion(questionId);
    if (!q) return null;

    const cached: CachedAnswer = {
      questionId,
      type: q.type || "BLANK",
      correctIndices: [],
      displayTexts: [],
      blankTexts: [],
      imageUrls: [],
      fetched: false,
    };

    // Extract answer length info from targets
    const targets = q.targets || [];
    targets.forEach((t: any) => {
      if (t.settings?.answerLength) {
        cached.blankTexts.push(`(${t.settings.answerLength} karakter)`);
        cached.displayTexts.push(`Jawaban: ${t.settings.answerLength} karakter`);
      }
    });

    return cached;
  },

  /**
   * Capture revealed answer from Pinia store (after user answers).
   */
  captureFromPinia(qId: string): void {
    const existing = S.answers.get(qId);
    if (existing && existing.fetched) return;

    const answerVal = Pinia.getAnswer(qId);
    const type = Pinia.getType(qId);
    const options = Pinia.getOptions(qId);

    const isRevealed = (type === "MCQ" || type === "MSQ")
      ? (typeof answerVal === "number" && answerVal >= 0) || (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "number" && answerVal[0] >= 0)
      : (type === "BLANK" || type === "OPEN") && Array.isArray(answerVal) && answerVal.length > 0;

    if (!isRevealed) return;

    const cached: CachedAnswer = {
      questionId: qId, type, correctIndices: [], displayTexts: [], blankTexts: [], imageUrls: [], fetched: true,
    };

    if (type === "MCQ" || type === "MSQ" || type === "IS" || type === "ORDER") {
      if (typeof answerVal === "number" && answerVal >= 0) cached.correctIndices.push(answerVal);
      else if (Array.isArray(answerVal)) answerVal.forEach((idx: number) => { if (typeof idx === "number" && idx >= 0) cached.correctIndices.push(idx); });

      cached.correctIndices.forEach((idx) => {
        if (idx < options.length) {
          const opt = options[idx];
          const rawText = stripHtml(opt.text || "");
          if (rawText) cached.displayTexts.push(rawText);
          if (opt.media?.[0]?.url) cached.imageUrls.push(opt.media[0].url.split("?")[0]);
        }
      });
    } else if (type === "BLANK" || type === "OPEN") {
      if (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "object") {
        const optMap = new Map<string, string>();
        options.forEach((o: any) => { if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text)); });
        (answerVal as Array<{targetId: string; optionId: string[]}>).forEach((a) => {
          a.optionId?.forEach((oid) => {
            const txt = optMap.get(oid);
            if (txt) { cached.blankTexts.push(txt); cached.displayTexts.push(txt); }
          });
        });
      }
      if (cached.blankTexts.length === 0) {
        options.forEach((o: any) => {
          const txt = stripHtml(o.text || "");
          if (txt) { cached.blankTexts.push(txt); cached.displayTexts.push(txt); }
        });
      }
    }

    S.answers.set(qId, cached);
  },
};

// ═══════════════════════════════════════════
//  DOM — OPTION SELECTION & HIGHLIGHTING
// ═══════════════════════════════════════════

const DOM = {
  /** Get all option elements with role="option" */
  getOptions(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  },

  /** Get option by API index using data-cy attribute */
  getOptionByIndex(idx: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-cy="option-${idx}"]`);
  },

  /** Get blank/FIB input */
  getBlankInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('[data-cy="fib-text-input"]')
      || document.querySelector<HTMLInputElement>('input.fib-text-input');
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

  /** Highlight correct option with gold glow */
  highlightCorrect(el: HTMLElement): void {
    el.style.outline = `2px solid ${T.gold}`;
    el.style.outlineOffset = "1px";
    el.style.boxShadow = `0 0 20px ${T.goldGlow}, inset 0 0 12px ${T.goldDim}`;
    el.style.transition = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.transform = "scale(1.04)";
    el.style.background = `linear-gradient(135deg, ${T.goldDim}, transparent)`;
    el.setAttribute("data-wg-correct", "1");
  },

  /** Dim wrong options */
  dimWrongOption(el: HTMLElement): void {
    el.style.opacity = T.dimOpacity;
    el.style.transition = "opacity 0.4s ease";
    el.setAttribute("data-wg-wrong", "1");
  },

  /** Extract background image URL from element */
  extractImageUrl(el: HTMLElement): string | null {
    const els = [el, ...Array.from(el.querySelectorAll<HTMLElement>("div"))];
    for (const e of els) {
      const bg = e.style.backgroundImage || getComputedStyle(e).backgroundImage;
      if (bg && bg.includes("url(")) {
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) return m[1].split("?")[0];
      }
    }
    return null;
  },

  /** Fill blank input with text */
  fillBlank(text: string): boolean {
    const input = this.getBlankInput();
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, text); else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  },
};

// ═══════════════════════════════════════════
//  ENGINE — CORE LOGIC
// ═══════════════════════════════════════════

const Engine = {
  /** Highlight correct options using cached answer */
  highlightAnswer(cached: CachedAnswer): boolean {
    const allOptions = DOM.getOptions();
    if (allOptions.length === 0 && cached.type !== "BLANK" && cached.type !== "OPEN") return false;

    // Handle BLANK/OPEN type
    if (cached.type === "BLANK" || cached.type === "OPEN") {
      if (cached.blankTexts.length > 0) {
        DOM.fillBlank(cached.blankTexts[0]);
      }
      return true;
    }

    // METHOD 1: data-cy="option-N" — PRIMARY & BULLETPROOF
    const correctEls: HTMLElement[] = [];
    for (const idx of cached.correctIndices) {
      const el = DOM.getOptionByIndex(idx);
      if (el) {
        correctEls.push(el);
        LOG.info(`Found option-${idx} via data-cy`);
      }
    }

    // METHOD 2: Text matching fallback
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

    // METHOD 3: Image URL fallback
    if (correctEls.length === 0 && cached.imageUrls.length > 0) {
      allOptions.forEach((el) => {
        const url = DOM.extractImageUrl(el);
        if (url) {
          for (const cu of cached.imageUrls) {
            if (url === cu || url.includes(cu) || cu.includes(url)) {
              correctEls.push(el);
              break;
            }
          }
        }
      });
    }

    // Apply highlights
    if (correctEls.length > 0) {
      const correctSet = new Set(correctEls);
      allOptions.forEach((el) => {
        if (correctSet.has(el)) DOM.highlightCorrect(el);
        else if (S.dimWrong) DOM.dimWrongOption(el);
      });
      LOG.success(`Highlighted ${correctEls.length} correct / ${allOptions.length} total`);
      return true;
    }

    return false;
  },

  /** Process current question — fetch answer if needed, then highlight */
  async processQuestion(qId: string): Promise<boolean> {
    const cached = S.answers.get(qId);
    const qType = Pinia.getType(qId);

    // Already have answer cached with actual data
    if (cached && cached.fetched && (cached.correctIndices.length > 0 || cached.blankTexts.length > 0)) {
      DOM.clearHighlights();
      this.updatePanel(qId, cached);
      const success = this.highlightAnswer(cached);
      if (success) S.lastHighlightQId = qId;
      return success;
    }

    // For BLANK/OPEN: show pending info while waiting for interceptor capture
    if (qType === "BLANK" || qType === "OPEN") {
      DOM.clearHighlights();
      const pendingCached = cached || ProceedAPI.buildBlankEntry(qId);
      if (pendingCached) {
        S.answers.set(qId, pendingCached);
        this.updatePanel(qId, pendingCached);
        Panel.updateStatus("Menunggu jawaban terungkap...", "loading");
        S.lastHighlightQId = qId;
      }
      return true; // Return true to prevent retry loop
    }

    // Need to fetch answer via Proceed API
    Panel.updateStatus("Mengambil jawaban...", "loading");

    const result = await ProceedAPI.fetchAndProcess(qId);

    if (result) {
      DOM.clearHighlights();
      this.updatePanel(qId, result);
      const success = this.highlightAnswer(result);
      if (success) S.lastHighlightQId = qId;

      // Save to cache
      if (S.roomHash) AnswerCache.save(S.roomHash);

      Panel.updateStatus("Jawaban ditemukan!", "ok");
      return success;
    }

    Panel.updateStatus("Gagal mengambil jawaban", "err");
    return false;
  },

  /** Update panel with question and answer info */
  updatePanel(qId: string, cached: CachedAnswer): void {
    const qText = stripHtml(Pinia.getText(qId));
    const type = Pinia.getType(qId);

    let answerDisplay = "—";
    if (cached.displayTexts.length > 0) answerDisplay = cached.displayTexts.join(" / ");
    else if (cached.imageUrls.length > 0) answerDisplay = `Opsi gambar ${cached.correctIndices.map(i => `#${i + 1}`).join(", ")}`;
    else if (cached.blankTexts.length > 0) answerDisplay = cached.blankTexts.join(" / ");
    else if (cached.correctIndices.length > 0) answerDisplay = `Opsi ${cached.correctIndices.map(i => `#${i + 1}`).join(", ")}`;

    Panel.updateQuestion(qText, type);
    Panel.updateAnswer(answerDisplay);
  },

  /** Main tick — called every 300ms */
  async tick(): Promise<void> {
    if (!Pinia.inGame) {
      if (S.inGame) {
        // Left the game
        this.stop();
      }
      return;
    }

    // Detect game start
    if (!S.inGame) {
      S.inGame = true;
      S.roomHash = Pinia.roomHash;
      S.roomCode = Pinia.roomCode;
      S.playerId = Pinia.playerId;
      S.quizVersionId = Pinia.quizVersionId;
      S.totalQ = Pinia.totalQuestions;

      LOG.always(`Game detected! Room: ${S.roomCode}, Questions: ${S.totalQ}`);

      // Load cached answers
      const cachedCount = AnswerCache.load(S.roomHash);
      if (cachedCount > 0) {
        LOG.success(`Loaded ${cachedCount} cached answers`);
        Panel.updateStatus(`${cachedCount} jawaban dari cache`, "ok");
      }

      Panel.updateStats();
    }

    // Capture any newly revealed answers from Pinia
    for (const qId of Pinia.questionIds) {
      ProceedAPI.captureFromPinia(qId);
    }

    const qId = Pinia.currentQId;
    if (!qId || qId === S.currentQId) return;

    S.currentQId = qId;
    LOG.info(`New question detected: ${qId}`);

    // Process the new question
    await this.processQuestion(qId);
    Panel.updateStats();
  },

  startPolling(): void {
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(() => this.tick(), 300);

    // Also watch for DOM changes to re-apply highlights
    this.setupDOMWatcher();
  },

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

    const originalTick = this.tick.bind(this);
    this.tick = async () => { reapplyCount = 0; await originalTick(); };

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  },

  stop(): void {
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
    DOM.clearHighlights();
    S.inGame = false;
    S.answers.clear();
    S.currentQId = "";
    S.lastHighlightQId = "";
    S.totalQ = 0;
    S.initialized = false;
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
    el.classList.add("ghost");
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

    // Setup interactions
    this.setupDrag(el);

    el.querySelector("#wg-btn-minimize")!.addEventListener("click", () => el.classList.toggle("ghost"));

    el.querySelector("#wg-btn-reload")!.addEventListener("click", async () => {
      // Re-fetch answer for current question
      S.fetchingQId = "";
      const qId = Pinia.currentQId;
      if (qId) {
        // Remove cached answer and re-fetch
        S.answers.delete(qId);
        await Engine.processQuestion(qId);
        Panel.updateStats();
      }
    });

    el.querySelector("#wg-dim")!.addEventListener("change", (e) => {
      S.dimWrong = (e.target as HTMLInputElement).checked;
      // Re-highlight current question
      if (S.lastHighlightQId) {
        S.lastHighlightQId = "";
        const qId = Pinia.currentQId;
        if (qId) Engine.processQuestion(qId);
      }
    });

    el.querySelector("#wg-debug")!.addEventListener("change", (e) => { S.debug = (e.target as HTMLInputElement).checked; });
  },

  setupDrag(el: HTMLElement): void {
    const header = el.querySelector("#wg-header") as HTMLElement;
    if (!header) return;
    let sx = 0, sy = 0, ix = 0, iy = 0;
    header.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;
      S.dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ix = r.left; iy = r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!S.dragging) return;
      el.style.left = `${ix + e.clientX - sx}px`;
      el.style.top = `${iy + e.clientY - sy}px`;
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { S.dragging = false; });
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
//  BOOT
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
//  FETCH INTERCEPTOR — Capture Proceed API responses
// ═══════════════════════════════════════════

const Interceptor = {
  installed: false,

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const originalFetch = window.fetch;
    const self = this;

    window.fetch = function(...args: Parameters<typeof fetch>): Promise<Response> {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;

      const result = originalFetch.apply(this, args);

      // Only intercept Proceed API responses
      if (url && url.includes("/proceed")) {
        result.then(response => {
          const clone = response.clone();
          clone.json().then(data => {
            self.handleProceedResponse(data);
          }).catch(() => {});
        }).catch(() => {});
      }

      return result;
    };

    LOG.info("Fetch interceptor installed");
  },

  handleProceedResponse(data: any): void {
    if (!data?.success) return;

    const questionId = data?.data?.response?.questionId;
    const answer = data?.data?.question?.structure?.answer;

    if (!questionId || answer === undefined || answer === null || answer === -1) return;

    const qType = data?.data?.response?.questionType || Pinia.getType(questionId);

    LOG.success(`Interceptor captured answer for ${questionId} (${qType}): ${JSON.stringify(answer)}`);

    // Update cache
    const existing = S.answers.get(questionId);

    if (qType === "BLANK" || qType === "OPEN") {
      // For BLANK: answer is typically array of {targetId, optionId[]}
      const cached: CachedAnswer = existing || {
        questionId, type: qType, correctIndices: [], displayTexts: [], blankTexts: [], imageUrls: [], fetched: false,
      };

      cached.fetched = true;

      // Parse BLANK answer
      if (Array.isArray(answer) && answer.length > 0 && typeof answer[0] === "object") {
        const options = Pinia.getOptions(questionId);
        const optMap = new Map<string, string>();
        options.forEach((o: any) => {
          if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text));
        });
        (answer as Array<{targetId: string; optionId: string[]}>).forEach((a) => {
          a.optionId?.forEach((oid) => {
            const txt = optMap.get(oid);
            if (txt) { cached.blankTexts.push(txt); cached.displayTexts.push(txt); }
          });
        });
      } else if (Array.isArray(answer)) {
        answer.forEach((a: any) => {
          if (typeof a === "string" && a) { cached.blankTexts.push(a); cached.displayTexts.push(a); }
        });
      }

      if (cached.blankTexts.length === 0) {
        cached.displayTexts = [JSON.stringify(answer)];
        cached.blankTexts = cached.displayTexts;
      }

      S.answers.set(questionId, cached);

      // Save cache
      if (S.roomHash) AnswerCache.save(S.roomHash);

      // Update panel if this is the current question
      if (questionId === S.currentQId) {
        Engine.updatePanel(questionId, cached);
      }
    } else if (qType === "MCQ" || qType === "MSQ" || qType === "IS" || qType === "ORDER") {
      // For MCQ/MSQ: also cache the answer from interceptor (redundant but safe)
      if (!existing || !existing.fetched) {
        ProceedAPI.processAnswer(questionId, answer);
        if (S.roomHash) AnswerCache.save(S.roomHash);
      }
    }
  },
};

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════

const Boot = {
  async start(): Promise<void> {
    LOG.always("Starting CheatWG v3.0 (Join Code Mode)...");

    // Install fetch interceptor first
    Interceptor.install();

    Panel.create();
    Panel.updateStatus("Menunggu permainan...", "loading");

    // Wait for game (up to 120s)
    for (let i = 0; i < 120; i++) {
      if (Pinia.inGame) break;
      await new Promise(r => setTimeout(r, 1000));

      // Update status every 5 seconds
      if (i % 5 === 0) {
        Panel.updateStatus(`Menunggu permainan...`, "loading");
      }
    }

    if (!Pinia.inGame) {
      Panel.updateStatus("Permainan tidak ditemukan!", "err");
      // Don't return - keep watching in case user joins later
      this.keepWatching();
      return;
    }

    this.initialize();
  },

  async initialize(): Promise<void> {
    if (S.initialized) return;
    S.initialized = true;

    // Get game info
    S.roomHash = Pinia.roomHash;
    S.roomCode = Pinia.roomCode;
    S.playerId = Pinia.playerId;
    S.quizVersionId = Pinia.quizVersionId;
    S.totalQ = Pinia.totalQuestions;
    S.inGame = true;

    LOG.success(`Game detected! Room: ${S.roomCode}, Hash: ${S.roomHash}, Questions: ${S.totalQ}`);

    // Try loading cached answers
    const cachedCount = AnswerCache.load(S.roomHash);
    if (cachedCount > 0) {
      LOG.success(`Loaded ${cachedCount} cached answers`);
      Panel.updateStatus(`${cachedCount} jawaban dari cache`, "ok");
    }

    Panel.updateStats();

    // Start polling
    Engine.startPolling();

    // Process current question if any
    const qId = Pinia.currentQId;
    if (qId) {
      S.currentQId = qId;
      await Engine.processQuestion(qId);
    }

    LOG.success("CheatWG v3.0 ready!");
    Panel.updateStatus("Aktif!", "ok");
  },

  /** Keep watching for game start even if initial wait timed out */
  keepWatching(): void {
    const watcher = setInterval(async () => {
      if (Pinia.inGame) {
        clearInterval(watcher);
        await this.initialize();
      }
    }, 2000);
  },

  stop(): void {
    if (S.roomHash) AnswerCache.save(S.roomHash);
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
    get dimWrong() { return S.dimWrong; }, set dimWrong(v) { S.dimWrong = v; },
    get debug() { return S.debug; }, set debug(v) { S.debug = v; },
  },
  cache: () => S.answers,
  stats: () => ({ total: S.totalQ, cached: S.answers.size, inGame: S.inGame, roomHash: S.roomHash, playerId: S.playerId }),
  pinia: () => ({
    roomHash: Pinia.roomHash,
    roomCode: Pinia.roomCode,
    playerId: Pinia.playerId,
    currentQId: Pinia.currentQId,
    inGame: Pinia.inGame,
    totalQuestions: Pinia.totalQuestions,
  }),
};

Boot.start();
