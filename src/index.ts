/*
════════════════════════════════════════════════════════════════════
  CheatWG v2.0 — Wayground Join Code Game Helper
  https://github.com/Danz-Pro/CheatWG

  DEEP ANALYSIS FINDINGS (Join Code Mode):
  ┌─────────────────────────────────────────────────────────────┐
  │ ★ KEY DISCOVERY: Proceed API leaks correct answers! ★      │
  │                                                             │
  │ POST /_gameapi/main/public/v1/games/{roomHash}/proceed     │
  │ → Response contains: data.question.structure.answer        │
  │ → Returns correct answer index BEFORE user answers!        │
  │                                                             │
  │ Other findings:                                             │
  │ 1. quizId is UNDEFINED in gameData for join code mode      │
  │ 2. Quiz API /_api/main/quiz/{id} — DOES NOT WORK          │
  │ 3. Game API /_api/main/game/{hash} — AUTH REQUIRED         │
  │ 4. Pinia answers: answer = -1 / [] for active questions    │
  │ 5. After answering: answer reveals correct index           │
  │ 6. data-cy="option-N" uses ORIGINAL API index              │
  │ 7. jumbleAnswers = true — display shuffled                 │
  │ 8. Proceed API body needs: roomHash, playerId, response,  │
  │    questionId, powerupEffects, quizVersionId, elapsed      │
  │ 9. Proceed pre-fetch makes question "attempted" on server  │
  │    but UI can still answer — result follows first attempt  │
  │                                                             │
  │ STRATEGY: "Pre-Fetch All via Proceed API"                  │
  │ → On game start, fetch ALL answers via proceed API         │
  │ → Cache answers for instant highlight                      │
  │ → Highlight correct option BEFORE user clicks              │
  │ → Cache to localStorage for next session                   │
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

const STATE = {
  answers: new Map<string, CachedAnswer>(),
  currentQId: "" as string,
  pollTimer: null as ReturnType<typeof setInterval> | null,
  panel: null as HTMLElement | null,
  style: null as HTMLElement | null,
  inGame: false,
  totalQ: 0,
  answeredQ: 0,
  correctQ: 0,
  dimWrong: true,
  debug: false,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  lastHighlightQId: "" as string,
  retryCount: 0,
  maxRetries: 15,
  roomHash: "" as string,
  roomCode: "" as string,
  playerId: "" as string,
  quizVersionId: "" as string,
  prefetched: false,
  fetchingInProgress: false,
};

// ═══════════════════════════════════════════
//  LOG
// ═══════════════════════════════════════════

const LOG = {
  info: (m: string) => STATE.debug && console.log(`%c[CheatWG]%c ${m}`, "color:#7c4dff;font-weight:bold", "color:inherit"),
  warn: (m: string) => console.warn(`%c[CheatWG]%c ${m}`, "color:#ffd54f;font-weight:bold", "color:inherit"),
  error: (m: string) => console.error(`%c[CheatWG]%c ${m}`, "color:#ff5252;font-weight:bold", "color:inherit"),
  success: (m: string) => console.log(`%c[CheatWG]%c ${m}`, "color:#00e676;font-weight:bold", "color:inherit"),
  always: (m: string) => console.log(`%c[CheatWG]%c ${m}`, "color:#7c4dff;font-weight:bold", "color:inherit"),
};

// ═══════════════════════════════════════════
//  PINIA ACCESS
// ═══════════════════════════════════════════

const Pinia = {
  get(): any {
    const root = document.querySelector("#root") || document.querySelector("#app");
    if (!root) return null;
    const app = (root as any).__vue_app__;
    if (!app) return null;
    return app.config.globalProperties?.$pinia || null;
  },

  store(name: string): any {
    const p = this.get();
    return p?._s.get(name) || null;
  },

  state(name: string): any {
    return this.store(name)?.$state || null;
  },

  get roomHash(): string | null { return this.state("gameData")?.roomHash || null; },
  get roomCode(): string | null { return this.state("gameData")?.roomCode || null; },
  get gameState(): string | null { return this.state("gameData")?.gameState || null; },
  get quizVersionId(): string | null { return this.state("gameData")?.quizVersionId || null; },

  get currentQId(): string | null {
    const gq = this.state("gameQuestions");
    return gq?.currentId || gq?.currentQuestionId || null;
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
  getState(qId: string): string { return this.getQuestion(qId)?.state || "unknown"; },

  get playerId(): string {
    const p = this.state("player");
    return p?.playerId || "";
  },

  get totalQuestions(): number {
    return this.state("gameData")?.totalQuestionsInQuiz || this.questionIds.length;
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
  KEY: "cheatwg_v2",

  save(roomHash: string): void {
    const data: Record<string, any> = {};
    STATE.answers.forEach((val, key) => { data[key] = val; });
    try {
      localStorage.setItem(`${this.KEY}_${roomHash}`, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  },

  load(roomHash: string): number {
    try {
      const raw = localStorage.getItem(`${this.KEY}_${roomHash}`);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      let count = 0;
      for (const [qId, ans] of Object.entries(data)) {
        STATE.answers.set(qId, ans as CachedAnswer);
        count++;
      }
      return count;
    } catch (e) { return 0; }
  },
};

// ═══════════════════════════════════════════
//  PROCEED API — JAWABAN TERUNGKAP!
// ═══════════════════════════════════════════

const ProceedAPI = {
  /**
   * Fetch correct answer for a question via Proceed API.
   * KEY DISCOVERY: Proceed API response contains data.question.structure.answer
   * which reveals the correct answer index!
   */
  async fetchAnswer(questionId: string, questionType: string): Promise<number | number[] | null> {
    if (STATE.fetchingInProgress) return null;

    const body = {
      roomHash: Pinia.roomHash || STATE.roomHash,
      playerId: Pinia.playerId || STATE.playerId,
      response: {
        attempt: 0,
        questionId: questionId,
        questionType: questionType,
        response: questionType === "MSQ" ? [0] : questionType === "BLANK" || questionType === "OPEN" ? "" : 0,
        responseType: "original",
        timeTaken: 1000 + Math.floor(Math.random() * 5000),
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
      quizVersionId: Pinia.quizVersionId || STATE.quizVersionId,
      elapsed: 0,
      isLastPlayerResponse: false,
    };

    try {
      const r = await fetch(
        `/_gameapi/main/public/v1/games/${STATE.roomHash}/proceed`,
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

      return null;
    } catch (e: any) {
      LOG.warn(`Proceed API error: ${e.message}`);
      return null;
    }
  },

  /**
   * Pre-fetch ALL answers at once via Proceed API.
   * Sequential with delay to avoid rate limiting.
   */
  async prefetchAllAnswers(): Promise<number> {
    if (STATE.prefetched || STATE.fetchingInProgress) return 0;
    STATE.fetchingInProgress = true;

    const qIds = Pinia.questionIds;
    let fetched = 0;

    LOG.always(`Pre-fetching answers for ${qIds.length} questions...`);
    Panel.updateStatus(`Mengambil ${qIds.length} jawaban...`, "loading");

    for (let i = 0; i < qIds.length; i++) {
      const qId = qIds[i];

      // Skip if already cached
      if (STATE.answers.has(qId) && STATE.answers.get(qId)!.correctIndices.length > 0) {
        fetched++;
        continue;
      }

      // Skip if already revealed in Pinia
      const piniaAnswer = Pinia.getAnswer(qId);
      const qType = Pinia.getType(qId);
      const isRevealed = (qType === "MCQ" || qType === "MSQ" || qType === "IS" || qType === "ORDER")
        ? (typeof piniaAnswer === "number" && piniaAnswer >= 0) || (Array.isArray(piniaAnswer) && piniaAnswer.length > 0 && typeof piniaAnswer[0] === "number" && piniaAnswer[0] >= 0)
        : (qType === "BLANK" || qType === "OPEN") && Array.isArray(piniaAnswer) && piniaAnswer.length > 0;

      if (isRevealed) {
        this.captureFromPinia(qId);
        fetched++;
        continue;
      }

      // Fetch from Proceed API
      const answer = await this.fetchAnswer(qId, qType);

      if (answer !== null) {
        const options = Pinia.getOptions(qId);
        const cached: CachedAnswer = {
          questionId: qId,
          type: qType,
          correctIndices: [],
          displayTexts: [],
          blankTexts: [],
          imageUrls: [],
        };

        // Parse answer
        if (qType === "MCQ" || qType === "MSQ" || qType === "IS" || qType === "ORDER") {
          if (typeof answer === "number" && answer >= 0) {
            cached.correctIndices.push(answer);
          } else if (Array.isArray(answer)) {
            answer.forEach((idx: number) => {
              if (typeof idx === "number" && idx >= 0) cached.correctIndices.push(idx);
            });
          }

          // Build display texts
          cached.correctIndices.forEach((idx) => {
            if (idx < options.length) {
              const opt = options[idx];
              const rawText = stripHtml(opt.text || "");
              if (rawText) cached.displayTexts.push(rawText);
              if (opt.media?.[0]?.url) cached.imageUrls.push(opt.media[0].url.split("?")[0]);
            }
          });
        } else if (qType === "BLANK" || qType === "OPEN") {
          if (Array.isArray(answer) && answer.length > 0 && typeof answer[0] === "object") {
            const optMap = new Map<string, string>();
            options.forEach((o: any) => { if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text)); });
            (answer as unknown as Array<{targetId: string; optionId: string[]}>).forEach((a) => {
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

        STATE.answers.set(qId, cached);
        fetched++;
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));

      // Update panel progress
      Panel.updateStatus(`Mengambil jawaban... ${i + 1}/${qIds.length}`, "loading");
    }

    STATE.prefetched = true;
    STATE.fetchingInProgress = false;

    if (STATE.roomHash) AnswerCache.save(STATE.roomHash);

    LOG.success(`Pre-fetch complete: ${fetched}/${qIds.length} answers fetched`);
    return fetched;
  },

  /** Capture revealed answer from Pinia store */
  captureFromPinia(qId: string): void {
    if (STATE.answers.has(qId) && STATE.answers.get(qId)!.correctIndices.length > 0) return;

    const answerVal = Pinia.getAnswer(qId);
    const type = Pinia.getType(qId);
    const options = Pinia.getOptions(qId);

    const isRevealed = (type === "MCQ" || type === "MSQ")
      ? (typeof answerVal === "number" && answerVal >= 0) || (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "number" && answerVal[0] >= 0)
      : (type === "BLANK" || type === "OPEN") && Array.isArray(answerVal) && answerVal.length > 0;

    if (!isRevealed) return;

    const cached: CachedAnswer = {
      questionId: qId, type, correctIndices: [], displayTexts: [], blankTexts: [], imageUrls: [],
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

    STATE.answers.set(qId, cached);
  },

  /** Capture all revealed answers from Pinia */
  captureAllRevealed(): number {
    let count = 0;
    for (const qId of Pinia.questionIds) {
      const prev = STATE.answers.get(qId);
      if (prev && prev.correctIndices.length > 0) continue;
      this.captureFromPinia(qId);
      if (STATE.answers.get(qId) && STATE.answers.get(qId)!.correctIndices.length > 0) count++;
    }
    return count;
  },
};

// ═══════════════════════════════════════════
//  DOM — OPTION SELECTION & HIGHLIGHTING
// ═══════════════════════════════════════════

const DOM = {
  getOptions(): HTMLElement[] { return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')); },
  getOptionByIndex(idx: number): HTMLElement | null { return document.querySelector<HTMLElement>(`[data-cy="option-${idx}"]`); },
  getBlankInput(): HTMLInputElement | null { return document.querySelector<HTMLInputElement>('[data-cy="fib-text-input"]') || document.querySelector<HTMLInputElement>('input.fib-text-input'); },
  getSubmitButton(): HTMLElement | null { return document.querySelector<HTMLElement>('[data-cy="submit-button"]') || document.querySelector<HTMLElement>('button[type="submit"]'); },

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

  highlightCorrect(el: HTMLElement): void {
    el.style.outline = `2px solid ${T.gold}`;
    el.style.outlineOffset = "1px";
    el.style.boxShadow = `0 0 20px ${T.goldGlow}, inset 0 0 12px ${T.goldDim}`;
    el.style.transition = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.transform = "scale(1.04)";
    el.style.background = `linear-gradient(135deg, ${T.goldDim}, transparent)`;
    el.setAttribute("data-wg-correct", "1");
  },

  dimWrong(el: HTMLElement): void {
    el.style.opacity = T.dimOpacity;
    el.style.transition = "opacity 0.4s ease";
    el.setAttribute("data-wg-wrong", "1");
  },

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

    if (cached.type === "BLANK" || cached.type === "OPEN") {
      if (cached.blankTexts.length > 0) {
        DOM.fillBlank(cached.blankTexts[0]);
      }
      return true;
    }

    // METHOD 1: data-cy="option-N" — BULLETPROOF
    const correctEls: HTMLElement[] = [];
    for (const idx of cached.correctIndices) {
      const el = DOM.getOptionByIndex(idx);
      if (el) correctEls.push(el);
    }

    // METHOD 2: Text fallback
    if (correctEls.length === 0 && cached.displayTexts.length > 0) {
      allOptions.forEach((el) => {
        const elText = stripHtml(el.textContent || "").toLowerCase();
        for (const ct of cached.displayTexts) {
          const ctLower = ct.toLowerCase();
          if (elText === ctLower || elText.includes(ctLower) || ctLower.includes(elText)) {
            correctEls.push(el); break;
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
            if (url === cu || url.includes(cu) || cu.includes(url)) { correctEls.push(el); break; }
          }
        }
      });
    }

    // METHOD 4: Numeric comparison
    if (correctEls.length === 0 && cached.displayTexts.length > 0) {
      allOptions.forEach((el) => {
        const elNum = parseFloat(stripHtml(el.textContent || "").replace(/[^\d.\-]/g, ""));
        for (const ct of cached.displayTexts) {
          const ctNum = parseFloat(ct.replace(/[^\d.\-]/g, ""));
          if (!isNaN(elNum) && !isNaN(ctNum) && Math.abs(elNum - ctNum) < 0.01) { correctEls.push(el); break; }
        }
      });
    }

    // Apply highlights
    if (correctEls.length > 0) {
      const correctSet = new Set(correctEls);
      allOptions.forEach((el) => {
        if (correctSet.has(el)) DOM.highlightCorrect(el);
        else if (STATE.dimWrong) DOM.dimWrong(el);
      });
      LOG.success(`Highlighted ${correctEls.length} correct / ${allOptions.length} total`);
      return true;
    }

    return false;
  },

  /** Process current question */
  processQuestion(qId: string): boolean {
    const cached = STATE.answers.get(qId);
    if (!cached || cached.correctIndices.length === 0) {
      LOG.warn(`No cached answer for ${qId}`);
      return false;
    }

    DOM.clearHighlights();

    const qText = stripHtml(Pinia.getText(qId));
    const type = Pinia.getType(qId);

    let answerDisplay = "—";
    if (cached.displayTexts.length > 0) answerDisplay = cached.displayTexts.join(" / ");
    else if (cached.imageUrls.length > 0) answerDisplay = `Opsi gambar ${cached.correctIndices.map(i => `#${i + 1}`).join(", ")}`;
    else if (cached.blankTexts.length > 0) answerDisplay = cached.blankTexts.join(" / ");

    Panel.updateQuestion(qText, type);
    Panel.updateAnswer(answerDisplay);

    const success = this.highlightAnswer(cached);
    if (success) STATE.lastHighlightQId = qId;
    return success;
  },

  /** Main tick — called every 200ms */
  tick(): void {
    if (!STATE.inGame) return;

    // Capture any newly revealed answers
    ProceedAPI.captureAllRevealed();

    const qId = Pinia.currentQId;
    if (!qId || qId === STATE.currentQId) return;

    STATE.currentQId = qId;
    STATE.answeredQ = Pinia.doneOrder.length;
    STATE.retryCount = 0;

    LOG.info(`New question: ${qId}`);

    const tryProcess = () => {
      if (STATE.retryCount >= STATE.maxRetries) return;
      const success = this.processQuestion(qId);
      if (!success) {
        STATE.retryCount++;
        setTimeout(tryProcess, 500);
      }
    };

    tryProcess();
    Panel.updateStats();
  },

  startPolling(): void {
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollTimer = setInterval(() => this.tick(), 200);
    this.setupDOMWatcher();
  },

  setupDOMWatcher(): void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let reapplyCount = 0;

    const observer = new MutationObserver((mutations) => {
      if (!STATE.lastHighlightQId || !Pinia.inGame) return;
      const cached = STATE.answers.get(STATE.lastHighlightQId);
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
        if (!document.querySelector("[data-wg-correct]") && reapplyCount < 3) {
          reapplyCount++;
          STATE.lastHighlightQId = "";
          const qId = Pinia.currentQId;
          if (qId) this.processQuestion(qId);
        }
      }, 300);
    });

    const originalTick = this.tick.bind(this);
    this.tick = () => { reapplyCount = 0; originalTick(); };

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  },

  stop(): void {
    if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; }
    DOM.clearHighlights();
    STATE.inGame = false;
    STATE.answers.clear();
    STATE.currentQId = "";
    STATE.lastHighlightQId = "";
    STATE.totalQ = 0;
    STATE.answeredQ = 0;
    STATE.correctQ = 0;
    STATE.prefetched = false;
  },
};

// ═══════════════════════════════════════════
//  PANEL — VVIP FLOATING UI
// ═══════════════════════════════════════════

const Panel = {
  create(): void {
    if (STATE.panel) return;
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
    STATE.panel = el;
    STATE.style = style;

    this.setupDrag(el);

    el.querySelector("#wg-btn-minimize")!.addEventListener("click", () => el.classList.toggle("ghost"));

    el.querySelector("#wg-btn-reload")!.addEventListener("click", async () => {
      STATE.prefetched = false;
      STATE.fetchingInProgress = false;
      await ProceedAPI.prefetchAllAnswers();
      const qId = Pinia.currentQId;
      if (qId) Engine.processQuestion(qId);
      Panel.updateStatus(`${STATE.answers.size} jawaban dimuat`, "ok");
    });

    el.querySelector("#wg-dim")!.addEventListener("change", (e) => { STATE.dimWrong = (e.target as HTMLInputElement).checked; });
    el.querySelector("#wg-debug")!.addEventListener("change", (e) => { STATE.debug = (e.target as HTMLInputElement).checked; });
  },

  setupDrag(el: HTMLElement): void {
    const header = el.querySelector("#wg-header") as HTMLElement;
    if (!header) return;
    let sx = 0, sy = 0, ix = 0, iy = 0;
    header.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" || target.tagName === "INPUT") return;
      STATE.dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ix = r.left; iy = r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!STATE.dragging) return;
      el.style.left = `${ix + e.clientX - sx}px`;
      el.style.top = `${iy + e.clientY - sy}px`;
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { STATE.dragging = false; });
  },

  updateStatus(text: string, type: "ok" | "err" | "loading" | "") {
    const el = STATE.panel?.querySelector("#wg-status");
    if (el) { el.className = type; const t = el.querySelector("#wg-status-text"); if (t) t.textContent = text; }
  },

  updateQuestion(text: string, type: string) {
    const el = STATE.panel?.querySelector("#wg-question");
    if (el) el.textContent = `${text.substring(0, 80)}${text.length > 80 ? "..." : ""} [${type}]`;
  },

  updateAnswer(text: string) {
    const el = STATE.panel?.querySelector("#wg-answer");
    if (el) el.textContent = text;
  },

  updateStats() {
    const el = STATE.panel?.querySelector("#wg-stats");
    if (el) {
      const done = Pinia.doneOrder.length;
      const cached = STATE.answers.size;
      el.innerHTML = `<span>${done}/${STATE.totalQ} dijawab</span><span>${cached} jawaban</span>`;
    }
  },

  destroy(): void {
    if (STATE.panel) { STATE.panel.remove(); STATE.panel = null; }
    if (STATE.style) { STATE.style.remove(); STATE.style = null; }
  },
};

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════

const Boot = {
  async start(): Promise<void> {
    LOG.always("Starting CheatWG v2.0 (Join Code Mode)...");

    Panel.create();
    Panel.updateStatus("Menunggu permainan...", "loading");

    // Wait for game (up to 60s)
    for (let i = 0; i < 60; i++) {
      if (Pinia.inGame) break;
      await new Promise(r => setTimeout(r, 1000));
      Panel.updateStatus(`Menunggu permainan... (${i + 1}d)`, "loading");
    }

    if (!Pinia.inGame) {
      Panel.updateStatus("Permainan tidak ditemukan!", "err");
      return;
    }

    // Get game info
    STATE.roomHash = Pinia.roomHash || "";
    STATE.roomCode = Pinia.roomCode || "";
    STATE.playerId = Pinia.playerId || "";
    STATE.quizVersionId = Pinia.quizVersionId || "";
    STATE.inGame = true;
    STATE.totalQ = Pinia.totalQuestions;

    LOG.success(`Game detected! Room: ${STATE.roomCode}, Hash: ${STATE.roomHash}, Questions: ${STATE.totalQ}`);

    // Try loading cached answers
    const cachedCount = AnswerCache.load(STATE.roomHash);
    if (cachedCount > 0) {
      LOG.success(`Loaded ${cachedCount} cached answers`);
      Panel.updateStatus(`${cachedCount} jawaban dari cache`, "ok");
    }

    // Pre-fetch ALL answers via Proceed API
    if (!STATE.prefetched) {
      const fetched = await ProceedAPI.prefetchAllAnswers();
      Panel.updateStatus(`${fetched} jawaban berhasil diambil`, "ok");
    }

    if (STATE.roomHash) AnswerCache.save(STATE.roomHash);
    Panel.updateStats();

    // Start polling
    Engine.startPolling();

    // Process current question
    const qId = Pinia.currentQId;
    if (qId) { STATE.currentQId = qId; Engine.processQuestion(qId); }

    LOG.success("CheatWG v2.0 ready!");
  },

  stop(): void {
    if (STATE.roomHash) AnswerCache.save(STATE.roomHash);
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
    get dimWrong() { return STATE.dimWrong; }, set dimWrong(v) { STATE.dimWrong = v; },
    get debug() { return STATE.debug; }, set debug(v) { STATE.debug = v; },
  },
  cache: () => STATE.answers,
  prefetch: () => ProceedAPI.prefetchAllAnswers(),
  stats: () => ({ total: STATE.totalQ, answered: STATE.answeredQ, cached: STATE.answers.size, prefetched: STATE.prefetched }),
};

Boot.start();
