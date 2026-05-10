/*
════════════════════════════════════════════════════════════════════
  CheatWG v4.0 — Wayground Join Code Game Helper
  https://github.com/Danz-Pro/CheatWG

  STRATEGY: "Pre-fetch & Highlight" (Proceed API)

  ═══ VERIFIED FINDINGS ═══
  • Proceed API: POST /_gameapi/main/public/v1/games/{roomHash}/proceed
  • Returns correct answers in data.question.structure.answer
  • Calling via fetch() does NOT affect game state!
  • MCQ:  response.response = 0       → answer = number
  • MSQ:  response.response = [0]     → answer = [number, ...]
  • BLANK: response.response = {media:null}
           response.answer = [{type:"BlankTargetObject",
             value:[{targetId, value:{text:"dummy"}}],
             descriptor:"Answer"}]
           → answer = [{optionId, targetId}], options = [{text}]
  • data-cy="option-N" uses ORIGINAL API index (not shuffled)
  • jumbleAnswers only shuffles visual order, not data-cy
  • WORDCLOUD: no correct answer (open-ended), skip
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
  blankText: string;
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
  lastHighlightQId: "",
  roomHash: "",
  roomCode: "",
  playerId: "",
  quizVersionId: "",
  fetchingQIds: new Set<string>(),
  initialized: false,
  fetchFailCount: 0,
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
  get roomCode(): string   { return this.state("gameData")?.roomCode || ""; },
  get gameState(): string  { return this.state("gameData")?.gameState || ""; },
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

  getQuestion(qId: string): any     { return this.questionList?.[qId] || null; },
  getType(qId: string): string      { return this.getQuestion(qId)?.type || "MCQ"; },
  getText(qId: string): string      { return this.getQuestion(qId)?.text || ""; },
  getOptions(qId: string): any[]    { return this.getQuestion(qId)?.options || []; },
  getAnswer(qId: string): any       { return this.getQuestion(qId)?.answer; },
  getState(qId: string): string     { return this.getQuestion(qId)?.state || ""; },
  getTargets(qId: string): any[]    { return this.getQuestion(qId)?.targets || []; },

  get playerId(): string {
    const p = this.state("player");
    return p?.playerId || "";
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
  KEY: "cheatwg_v4",

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
//  PROCEED API — CORRECT ANSWER EXTRACTOR
// ═══════════════════════════════════════════

const ProceedAPI = {

  buildBodyMCQ(questionId: string): any {
    return {
      roomHash: S.roomHash,
      playerId: S.playerId,
      response: {
        attempt: 0,
        questionId,
        questionType: "MCQ",
        response: 0,
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

  buildBodyMSQ(questionId: string): any {
    return {
      roomHash: S.roomHash,
      playerId: S.playerId,
      response: {
        attempt: 0,
        questionId,
        questionType: "MSQ",
        response: [0],
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

  buildBodyBLANK(questionId: string): any {
    const targets = Pinia.getTargets(questionId);
    const targetId = targets?.[0]?.id || "";
    return {
      roomHash: S.roomHash,
      playerId: S.playerId,
      response: {
        attempt: 0,
        questionId,
        questionType: "BLANK",
        response: { media: null },
        responseType: "original",
        timeTaken: 2000 + Math.floor(Math.random() * 4000),
        answer: [{
          type: "BlankTargetObject",
          value: [{ targetId, value: { text: "x" } }],
          descriptor: "Answer",
        }],
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

  async fetchAnswer(questionId: string): Promise<{ answer: any; options?: any[] } | null> {
    if (S.fetchingQIds.has(questionId)) return null;
    S.fetchingQIds.add(questionId);

    const qType = Pinia.getType(questionId);
    let body: any;

    if (qType === "MCQ" || qType === "IS" || qType === "ORDER") {
      body = this.buildBodyMCQ(questionId);
    } else if (qType === "MSQ") {
      body = this.buildBodyMSQ(questionId);
    } else if (qType === "BLANK" || qType === "OPEN") {
      body = this.buildBodyBLANK(questionId);
    } else {
      LOG.info(`Skipping unsupported type: ${qType}`);
      S.fetchingQIds.delete(questionId);
      return null;
    }

    try {
      LOG.info(`Proceed API: fetching answer for ${questionId} (${qType})`);

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
        S.fetchFailCount++;
        return null;
      }

      const d = await r.json();
      if (!d.success) {
        LOG.warn(`Proceed API: not success for ${questionId}: ${d.error || "unknown"}`);
        S.fetchFailCount++;
        return null;
      }

      const answer = d?.data?.question?.structure?.answer;
      const options = d?.data?.question?.structure?.options;

      if (answer !== undefined && answer !== null) {
        LOG.success(`Proceed API: answer for ${questionId} = ${JSON.stringify(answer)}`);
        S.fetchFailCount = 0;
        return { answer, options };
      }

      LOG.warn(`Proceed API: no answer in response for ${questionId}`);
      return null;
    } catch (e: any) {
      LOG.error(`Proceed API error: ${e.message}`);
      S.fetchFailCount++;
      return null;
    } finally {
      S.fetchingQIds.delete(questionId);
    }
  },

  processAnswer(questionId: string, apiAnswer: any, apiOptions?: any[]): CachedAnswer {
    const qType = Pinia.getType(questionId);
    const options = Pinia.getOptions(questionId);

    const cached: CachedAnswer = {
      questionId,
      type: qType,
      correctIndices: [],
      displayTexts: [],
      blankText: "",
      fetched: true,
    };

    if (qType === "MCQ" || qType === "IS" || qType === "ORDER") {
      if (typeof apiAnswer === "number" && apiAnswer >= 0) {
        cached.correctIndices.push(apiAnswer);
      }
      cached.correctIndices.forEach((idx) => {
        if (idx < options.length) {
          const txt = stripHtml(options[idx].text || "");
          if (txt) cached.displayTexts.push(txt);
        }
      });
    } else if (qType === "MSQ") {
      if (Array.isArray(apiAnswer)) {
        apiAnswer.forEach((idx: number) => {
          if (typeof idx === "number" && idx >= 0) cached.correctIndices.push(idx);
        });
      }
      cached.correctIndices.forEach((idx) => {
        if (idx < options.length) {
          const txt = stripHtml(options[idx].text || "");
          if (txt) cached.displayTexts.push(txt);
        }
      });
    } else if (qType === "BLANK" || qType === "OPEN") {
      if (Array.isArray(apiAnswer) && apiAnswer.length > 0 && typeof apiAnswer[0] === "object") {
        const optionIds: string[] = [];
        apiAnswer.forEach((a: any) => {
          if (a.optionId && Array.isArray(a.optionId)) {
            a.optionId.forEach((oid: string) => optionIds.push(oid));
          }
        });

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

        if (!cached.blankText && options.length > 0) {
          const optMap = new Map<string, string>();
          options.forEach((o: any) => {
            if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text));
          });
          optionIds.forEach((oid) => {
            const txt = optMap.get(oid);
            if (txt) { cached.blankText = txt; cached.displayTexts.push(txt); }
          });
        }
      }
    }

    S.answers.set(questionId, cached);
    return cached;
  },

  async fetchAndProcess(questionId: string): Promise<CachedAnswer | null> {
    const existing = S.answers.get(questionId);
    if (existing && existing.fetched && (existing.correctIndices.length > 0 || existing.blankText)) {
      return existing;
    }

    const qType = Pinia.getType(questionId);

    if (qType === "WORDCLOUD") {
      LOG.info(`WORDCLOUD question, no correct answer`);
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
  getOptions(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  },

  getOptionByIndex(idx: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-cy="option-${idx}"]`);
  },

  getBlankInputs(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input.fib-box-input'));
  },

  getBlankTextInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('[data-cy="fib-text-input"]')
      || document.querySelector<HTMLInputElement>('input.fib-text-input');
  },

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

  dimWrongOption(el: HTMLElement): void {
    el.style.opacity = T.dimOpacity;
    el.style.transition = "opacity 0.4s ease";
    el.setAttribute("data-wg-wrong", "1");
  },

  fillBlankBoxes(text: string, qId?: string): boolean {
    const inputs = this.getBlankInputs();
    if (inputs.length === 0) return false;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;

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
      while (specialIndices.includes(charIdx) && charIdx < text.length) {
        charIdx++;
      }
      if (charIdx < text.length) {
        setter.call(inputs[boxIdx], text[charIdx]);
        inputs[boxIdx].dispatchEvent(new Event("input", { bubbles: true }));
        charIdx++;
      }
    }
    LOG.success(`Filled blank boxes: "${text}" (${inputs.length} boxes, ${specialIndices.length} special chars skipped)`);
    return true;
  },

  fillBlankText(text: string): boolean {
    const input = this.getBlankTextInput();
    if (!input) return false;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, text); else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    LOG.success(`Filled blank text: "${text}"`);
    return true;
  },
};

// ═══════════════════════════════════════════
//  ENGINE — CORE LOGIC
// ═══════════════════════════════════════════

const Engine = {
  highlightAnswer(cached: CachedAnswer): boolean {
    if (cached.type === "BLANK" || cached.type === "OPEN") {
      if (!cached.blankText) return false;
      const filled = DOM.fillBlankBoxes(cached.blankText, cached.questionId) || DOM.fillBlankText(cached.blankText);
      return filled;
    }

    const allOptions = DOM.getOptions();
    if (allOptions.length === 0) return false;

    const correctEls: HTMLElement[] = [];

    for (const idx of cached.correctIndices) {
      const el = DOM.getOptionByIndex(idx);
      if (el) {
        correctEls.push(el);
        LOG.info(`Found option-${idx} via data-cy`);
      }
    }

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

    if (correctEls.length > 0) {
      const correctSet = new Set(correctEls);
      allOptions.forEach((el) => {
        if (correctSet.has(el)) DOM.highlightCorrect(el);
        else if (S.dimWrong) DOM.dimWrongOption(el);
      });
      LOG.success(`Highlighted ${correctEls.length} correct / ${allOptions.length} total`);
      return true;
    }

    LOG.warn(`Could not match any correct option in DOM`);
    return false;
  },

  async processQuestion(qId: string): Promise<boolean> {
    const cached = S.answers.get(qId);

    if (cached && cached.fetched && (cached.correctIndices.length > 0 || cached.blankText)) {
      DOM.clearHighlights();
      this.updatePanel(qId, cached);
      const success = this.highlightAnswer(cached);
      if (success) S.lastHighlightQId = qId;
      return success;
    }

    Panel.updateStatus("Mengambil jawaban...", "loading");

    const result = await ProceedAPI.fetchAndProcess(qId);

    if (result) {
      DOM.clearHighlights();
      this.updatePanel(qId, result);
      const success = this.highlightAnswer(result);
      if (success) S.lastHighlightQId = qId;

      if (S.roomHash) AnswerCache.save(S.roomHash);

      Panel.updateStatus("Jawaban ditemukan!", "ok");
      return success;
    }

    const qType = Pinia.getType(qId);
    if (qType === "WORDCLOUD") {
      Panel.updateStatus("WORDCLOUD - tidak ada jawaban", "loading");
      return true;
    }

    Panel.updateStatus("Gagal mengambil jawaban", "err");
    return false;
  },

  updatePanel(qId: string, cached: CachedAnswer): void {
    const qText = stripHtml(Pinia.getText(qId));
    const type = Pinia.getType(qId);

    let answerDisplay = "—";
    if (cached.blankText) {
      answerDisplay = cached.blankText;
    } else if (cached.displayTexts.length > 0) {
      answerDisplay = cached.displayTexts.join(" / ");
    } else if (cached.correctIndices.length > 0) {
      answerDisplay = `Opsi ${cached.correctIndices.map(i => `#${i + 1}`).join(", ")}`;
    }

    Panel.updateQuestion(qText, type);
    Panel.updateAnswer(answerDisplay);
  },

  async tick(): Promise<void> {
    if (!Pinia.inGame) {
      if (S.inGame) this.stop();
      return;
    }

    if (!S.inGame) {
      S.inGame = true;
      S.roomHash = Pinia.roomHash;
      S.roomCode = Pinia.roomCode;
      S.playerId = Pinia.playerId;
      S.quizVersionId = Pinia.quizVersionId;
      S.totalQ = Pinia.totalQuestions;

      LOG.always(`Game detected! Room: ${S.roomCode}, Player: ${S.playerId}, Questions: ${S.totalQ}`);

      const cachedCount = AnswerCache.load(S.roomHash);
      if (cachedCount > 0) {
        LOG.success(`Loaded ${cachedCount} cached answers`);
        Panel.updateStatus(`${cachedCount} jawaban dari cache`, "ok");
      }

      Panel.updateStats();
    }

    const qId = Pinia.currentQId;
    if (!qId || qId === S.currentQId) return;

    S.currentQId = qId;
    LOG.info(`New question detected: ${qId} (${Pinia.getType(qId)})`);

    await this.processQuestion(qId);
    Panel.updateStats();
  },

  startPolling(): void {
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(() => this.tick(), 300);
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

    this.setupDrag(el);

    el.querySelector("#wg-btn-minimize")!.addEventListener("click", () => el.classList.toggle("ghost"));

    el.querySelector("#wg-btn-reload")!.addEventListener("click", async () => {
      S.fetchingQIds.clear();
      const qId = Pinia.currentQId;
      if (qId) {
        S.answers.delete(qId);
        await Engine.processQuestion(qId);
        Panel.updateStats();
      }
    });

    el.querySelector("#wg-dim")!.addEventListener("change", (e) => {
      S.dimWrong = (e.target as HTMLInputElement).checked;
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
//  XHR INTERCEPTOR — Capture game's own Proceed responses
// ═══════════════════════════════════════════

const Interceptor = {
  installed: false,

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function(method: string, url: string | URL) {
      (this as any).__wgUrl = typeof url === "string" ? url : url.toString();
      return origOpen.apply(this, [method, url] as any);
    };

    XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
      const url = (this as any).__wgUrl;
      if (url && url.includes("/proceed")) {
        const xhr = this;
        const origOnReady = xhr.onreadystatechange;

        xhr.onreadystatechange = function(ev: Event) {
          if (xhr.readyState === 4 && xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              self.handleProceedResponse(data);
            } catch {}
          }
          if (origOnReady) origOnReady.call(this, ev);
        };
      }
      return origSend.call(this, body);
    };

    LOG.info("XHR interceptor installed");
  },

  handleProceedResponse(data: any): void {
    if (!data?.success) return;

    const questionId = data?.data?.response?.questionId;
    const answer = data?.data?.question?.structure?.answer;
    const options = data?.data?.question?.structure?.options;

    if (!questionId || answer === undefined || answer === null) return;

    const qType = data?.data?.response?.questionType || Pinia.getType(questionId);

    LOG.success(`Interceptor: captured answer for ${questionId} (${qType}): ${JSON.stringify(answer)}`);

    const existing = S.answers.get(questionId);

    if (qType === "MCQ" || qType === "MSQ" || qType === "IS" || qType === "ORDER") {
      if (!existing || !existing.fetched) {
        ProceedAPI.processAnswer(questionId, answer);
        if (S.roomHash) AnswerCache.save(S.roomHash);
      }
    } else if (qType === "BLANK" || qType === "OPEN") {
      if (Array.isArray(answer) && answer.length > 0 && typeof answer[0] === "object") {
        const cached: CachedAnswer = existing || {
          questionId, type: qType, correctIndices: [], displayTexts: [], blankText: "", fetched: false,
        };

        const optionIds: string[] = [];
        answer.forEach((a: any) => {
          if (a.optionId && Array.isArray(a.optionId)) {
            a.optionId.forEach((oid: string) => optionIds.push(oid));
          }
        });

        if (Array.isArray(options)) {
          options.forEach((opt: any) => {
            if (optionIds.includes(opt.id || opt._id)) {
              const txt = stripHtml(opt.text || "");
              if (txt) { cached.blankText = txt; cached.displayTexts.push(txt); }
            }
          });
        }

        if (!cached.blankText) {
          const gameOptions = Pinia.getOptions(questionId);
          if (gameOptions.length > 0) {
            const optMap = new Map<string, string>();
            gameOptions.forEach((o: any) => { if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text)); });
            optionIds.forEach((oid) => {
              const txt = optMap.get(oid);
              if (txt) { cached.blankText = txt; cached.displayTexts.push(txt); }
            });
          }
        }

        cached.fetched = true;
        S.answers.set(questionId, cached);
        if (S.roomHash) AnswerCache.save(S.roomHash);

        if (questionId === S.currentQId) {
          Engine.updatePanel(questionId, cached);
        }
      }
    }
  },
};

// ═══════════════════════════════════════════
//  PINIA WATCHER — Capture revealed answers
// ═══════════════════════════════════════════

const PiniaWatcher = {
  captureRevealedAnswers(): void {
    for (const qId of Pinia.questionIds) {
      const existing = S.answers.get(qId);
      if (existing && existing.fetched) continue;

      const answerVal = Pinia.getAnswer(qId);
      const type = Pinia.getType(qId);
      const qState = Pinia.getState(qId);

      if (qState !== "reveal") continue;

      if (type === "MCQ" && typeof answerVal === "number" && answerVal >= 0) {
        const options = Pinia.getOptions(qId);
        const cached: CachedAnswer = {
          questionId: qId, type, correctIndices: [answerVal],
          displayTexts: [], blankText: "", fetched: true,
        };
        if (answerVal < options.length) {
          const txt = stripHtml(options[answerVal].text || "");
          if (txt) cached.displayTexts.push(txt);
        }
        S.answers.set(qId, cached);
      } else if (type === "MSQ" && Array.isArray(answerVal) && answerVal.length > 0 && answerVal.every((v: any) => typeof v === "number" && v >= 0)) {
        const options = Pinia.getOptions(qId);
        const cached: CachedAnswer = {
          questionId: qId, type, correctIndices: answerVal,
          displayTexts: [], blankText: "", fetched: true,
        };
        answerVal.forEach((idx: number) => {
          if (idx < options.length) {
            const txt = stripHtml(options[idx].text || "");
            if (txt) cached.displayTexts.push(txt);
          }
        });
        S.answers.set(qId, cached);
      } else if ((type === "BLANK" || type === "OPEN") && Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "object") {
        const options = Pinia.getOptions(qId);
        const optionIds: string[] = [];
        answerVal.forEach((a: any) => {
          if (a.optionId && Array.isArray(a.optionId)) {
            a.optionId.forEach((oid: string) => optionIds.push(oid));
          }
        });

        const cached: CachedAnswer = {
          questionId: qId, type, correctIndices: [], displayTexts: [], blankText: "", fetched: true,
        };

        if (options.length > 0) {
          const optMap = new Map<string, string>();
          options.forEach((o: any) => { if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text)); });
          optionIds.forEach((oid) => {
            const txt = optMap.get(oid);
            if (txt) { cached.blankText = txt; cached.displayTexts.push(txt); }
          });
        }

        S.answers.set(qId, cached);
      }
    }
  },
};

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════

const Boot = {
  async start(): Promise<void> {
    LOG.always("Starting CheatWG v4.0 (Join Code Mode)...");

    Interceptor.install();

    Panel.create();
    Panel.updateStatus("Menunggu permainan...", "loading");

    for (let i = 0; i < 120; i++) {
      if (Pinia.inGame) break;
      await new Promise(r => setTimeout(r, 1000));
      if (i % 5 === 0) Panel.updateStatus(`Menunggu permainan...`, "loading");
    }

    if (!Pinia.inGame) {
      Panel.updateStatus("Permainan tidak ditemukan!", "err");
      this.keepWatching();
      return;
    }

    this.initialize();
  },

  async initialize(): Promise<void> {
    if (S.initialized) return;
    S.initialized = true;

    S.roomHash = Pinia.roomHash;
    S.roomCode = Pinia.roomCode;
    S.playerId = Pinia.playerId;
    S.quizVersionId = Pinia.quizVersionId;
    S.totalQ = Pinia.totalQuestions;
    S.inGame = true;

    LOG.success(`Game detected! Room: ${S.roomCode}, Player: ${S.playerId}, Questions: ${S.totalQ}`);

    const cachedCount = AnswerCache.load(S.roomHash);
    if (cachedCount > 0) {
      LOG.success(`Loaded ${cachedCount} cached answers`);
      Panel.updateStatus(`${cachedCount} jawaban dari cache`, "ok");
    }

    Panel.updateStats();

    Engine.startPolling();

    PiniaWatcher.captureRevealedAnswers();

    const qId = Pinia.currentQId;
    if (qId) {
      S.currentQId = qId;
      await Engine.processQuestion(qId);
    }

    LOG.success("CheatWG v4.0 ready!");
    Panel.updateStatus("Aktif!", "ok");
  },

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
