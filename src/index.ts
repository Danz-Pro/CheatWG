/*
════════════════════════════════════════════════════════════════════
  CheatWG v1.0 — Wayground Join Code Game Helper
  https://github.com/Danz-Pro/CheatWG

  ANALYSIS FINDINGS (Join Code Mode):
  ┌─────────────────────────────────────────────────────────────┐
  │ ⚠️  Join code mode is DIFFERENT from practice mode!        │
  │                                                             │
  │ 1. quizId is UNDEFINED in gameData (only quizVersionId)    │
  │ 2. Quiz API /_api/main/quiz/{id} — DOES NOT WORK          │
  │ 3. Game API /_api/main/game/{hash} — AUTH REQUIRED         │
  │ 4. Answers are HIDDEN: answer = -1 for active questions    │
  │ 5. After answering, answer reveals correct index (0-based) │
  │ 6. data-cy="option-N" uses ORIGINAL API index              │
  │ 7. jumbleAnswers = true — display order is shuffled        │
  │ 8. roomHash & roomCode available in gameData               │
  │ 9. URL pattern: /join/game/{encryptedHash}                 │
  │ 10. Redemption may be available for re-answering           │
  │                                                             │
  │ STRATEGY: "Pre-Solve & Cache"                               │
  │ → Answer each question with option 0 (sacrifice)           │
  │ → After reveal, capture correct answer from Pinia store     │
  │ → Cache all correct answers for the session                 │
  │ → On next play/replay, use cached answers for 100% correct │
  │ → Real-time mode: sacrifice → reveal → show in panel       │
  └─────────────────────────────────────────────────────────────┘
════════════════════════════════════════════════════════════════════
*/

// ═══════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════

interface CachedAnswer {
  questionId: string;
  type: string;
  /** MCQ/MSQ: 0-based correct option index (from API) */
  correctIndices: number[];
  /** Display text of correct options */
  displayTexts: string[];
  /** BLANK: accepted text answers */
  blankTexts: string[];
  /** Image URLs of correct options */
  imageUrls: string[];
  /** Has this answer been revealed? */
  revealed: boolean;
}

interface ParsedOption {
  index: number;
  id: string;
  text: string;
  media?: { type: string; url: string }[];
}

// ═══════════════════════════════════════════
//  THEME — Black & Navy VVIP (sama dengan WG)
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
  /** Cached answers — key = questionId */
  answers: new Map<string, CachedAnswer>(),
  /** Current question ID from Pinia */
  currentQId: "" as string,
  /** Previous question ID for change detection */
  prevQId: "" as string,
  /** Polling timer */
  pollTimer: null as ReturnType<typeof setInterval> | null,
  /** Panel DOM element */
  panel: null as HTMLElement | null,
  /** Style DOM element */
  style: null as HTMLElement | null,
  /** Are we in a game? */
  inGame: false,
  /** Total questions in quiz */
  totalQ: 0,
  /** Questions answered (done) */
  answeredQ: 0,
  /** Questions we got correct */
  correctQ: 0,
  /** Auto-sacrifice mode — automatically click option 0 to reveal answer */
  autoSacrifice: true,
  /** Dim wrong options after reveal */
  dimWrong: true,
  /** Debug mode */
  debug: false,
  /** Show panel */
  showPanel: true,
  /** Dragging state */
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  /** Last highlighted question ID */
  lastHighlightQId: "" as string,
  /** Retry counter for current question */
  retryCount: 0,
  maxRetries: 15,
  /** Are we currently sacrificing? */
  sacrificing: false,
  /** Phase: "waiting" | "sacrificing" | "revealed" */
  phase: "waiting" as string,
  /** Room hash for caching */
  roomHash: "" as string,
  /** Room code */
  roomCode: "" as string,
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

  get roomHash(): string | null {
    return this.state("gameData")?.roomHash || null;
  },

  get roomCode(): string | null {
    return this.state("gameData")?.roomCode || null;
  },

  get gameState(): string | null {
    return this.state("gameData")?.gameState || null;
  },

  get gameType(): string | null {
    return this.state("gameData")?.gameType || null;
  },

  get currentQId(): string | null {
    const gq = this.state("gameQuestions");
    return gq?.currentId || gq?.currentQuestionId || null;
  },

  get inGame(): boolean {
    const gd = this.state("gameData");
    return !!(gd?.roomHash && gd?.gameState);
  },

  get questionList(): Record<string, any> {
    return this.state("gameQuestions")?.list || {};
  },

  get doneOrder(): string[] {
    return this.state("gameQuestions")?.doneOrder || [];
  },

  get remainingOrder(): string[] {
    return this.state("gameQuestions")?.remainingOrder || [];
  },

  /** Get question data from Pinia store */
  getQuestion(qId: string): any {
    return this.questionList?.[qId] || null;
  },

  /** Get the answer field for a question (-1 if not revealed) */
  getAnswer(qId: string): number | number[] | any[] {
    const q = this.getQuestion(qId);
    return q?.answer;
  },

  /** Get question state ("active" | "reveal") */
  getQuestionState(qId: string): string {
    const q = this.getQuestion(qId);
    return q?.state || "unknown";
  },

  /** Get options for a question */
  getOptions(qId: string): any[] {
    const q = this.getQuestion(qId);
    return q?.options || [];
  },

  /** Get question type */
  getType(qId: string): string {
    const q = this.getQuestion(qId);
    return q?.type || "MCQ";
  },

  /** Get question text */
  getText(qId: string): string {
    const q = this.getQuestion(qId);
    return q?.text || "";
  },

  /** Check if redemption is available */
  get hasRedemption(): boolean {
    const gd = this.state("gameData");
    return gd?.gameOptions?.redemption === "yes";
  },

  /** Check if jumbleAnswers is enabled */
  get jumbleAnswers(): boolean {
    const gd = this.state("gameData");
    return gd?.gameOptions?.jumbleAnswers === true;
  },
};

// ═══════════════════════════════════════════
//  HTML / TEXT UTILITIES
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
  STORAGE_KEY: "cheatwg_answers",

  /** Save answers for a room to localStorage */
  save(roomHash: string): void {
    const data: Record<string, any> = {};
    STATE.answers.forEach((val, key) => {
      if (val.revealed) {
        data[key] = val;
      }
    });
    try {
      localStorage.setItem(`${this.STORAGE_KEY}_${roomHash}`, JSON.stringify(data));
      LOG.info(`Cached ${Object.keys(data).length} answers for room ${roomHash}`);
    } catch (e) {
      LOG.warn("Failed to save cache");
    }
  },

  /** Load cached answers for a room */
  load(roomHash: string): number {
    try {
      const raw = localStorage.getItem(`${this.STORAGE_KEY}_${roomHash}`);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      let count = 0;
      for (const [qId, ans] of Object.entries(data)) {
        const a = ans as CachedAnswer;
        if (a.revealed) {
          STATE.answers.set(qId, a);
          count++;
        }
      }
      LOG.success(`Loaded ${count} cached answers for room ${roomHash}`);
      return count;
    } catch (e) {
      return 0;
    }
  },

  /** Auto-save periodically */
  startAutoSave(): void {
    setInterval(() => {
      if (STATE.roomHash) {
        this.save(STATE.roomHash);
      }
    }, 5000);
  },
};

// ═══════════════════════════════════════════
//  DOM — OPTION SELECTION & HIGHLIGHTING
// ═══════════════════════════════════════════

const DOM = {
  /** Get all option elements on current question */
  getOptions(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  },

  /** Get option by API index — uses data-cy which is NOT shuffled */
  getOptionByIndex(idx: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-cy="option-${idx}"]`);
  },

  /** Get BLANK input element */
  getBlankInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('[data-cy="fib-text-input"]') ||
           document.querySelector<HTMLInputElement>('input.fib-text-input');
  },

  /** Get Submit button for BLANK questions */
  getSubmitButton(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-cy="submit-button"]') ||
           document.querySelector<HTMLElement>('button[type="submit"]');
  },

  /** Clear all previous highlights */
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

  /** Highlight a correct option element with gold VVIP style */
  highlightCorrect(el: HTMLElement): void {
    el.style.outline = `2px solid ${T.gold}`;
    el.style.outlineOffset = "1px";
    el.style.boxShadow = `0 0 20px ${T.goldGlow}, inset 0 0 12px ${T.goldDim}`;
    el.style.transition = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.transform = "scale(1.04)";
    el.style.background = `linear-gradient(135deg, ${T.goldDim}, transparent)`;
    el.setAttribute("data-wg-correct", "1");
  },

  /** Dim a wrong option element */
  dimWrong(el: HTMLElement): void {
    el.style.opacity = T.dimOpacity;
    el.style.transition = "opacity 0.4s ease";
    el.setAttribute("data-wg-wrong", "1");
  },

  /** Extract background-image URL from element */
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

  /** Fill BLANK input with correct answer text */
  fillBlank(text: string): boolean {
    const input = this.getBlankInput();
    if (!input) {
      LOG.warn("BLANK input not found in DOM");
      return false;
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(input, text);
    } else {
      input.value = text;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    LOG.success(`Filled blank: "${text}"`);
    return true;
  },

  /** Click the first option to sacrifice (reveal answer) */
  clickFirstOption(): boolean {
    const options = this.getOptions();
    if (options.length === 0) {
      LOG.warn("No options found to sacrifice");
      return false;
    }

    const blankInput = this.getBlankInput();
    if (blankInput) {
      // For BLANK questions, fill with a dummy answer
      this.fillBlank("x");
      setTimeout(() => {
        const btn = this.getSubmitButton();
        if (btn) btn.click();
      }, 200);
      LOG.info("Sacrificed BLANK with dummy answer");
      return true;
    }

    options[0].click();
    LOG.info("Sacrificed by clicking first option");
    return true;
  },
};

// ═══════════════════════════════════════════
//  ENGINE — CORE LOGIC FOR JOIN CODE MODE
// ═══════════════════════════════════════════

const Engine = {
  /**
   * Capture revealed answer from Pinia store after answering.
   * In join code mode, answers are hidden (answer=-1) until question is answered.
   * After answering, state changes to "reveal" and answer shows correct index.
   */
  captureRevealedAnswers(): number {
    let captured = 0;
    const qList = Pinia.questionList;

    for (const [qId, q] of Object.entries(qList)) {
      const question = q as any;
      const existing = STATE.answers.get(qId);

      // Skip if already captured
      if (existing?.revealed) continue;

      const answerVal = question.answer;
      const state = question.state;
      const type = question.type;

      // Check if answer is revealed (not -1, not empty array)
      const isRevealed = (type === "MCQ" || type === "MSQ" || type === "IS" || type === "ORDER")
        ? (typeof answerVal === "number" && answerVal >= 0) || (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "number" && answerVal[0] >= 0)
        : (type === "BLANK" || type === "OPEN")
          ? (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "object")
          : false;

      if (isRevealed) {
        const cached: CachedAnswer = {
          questionId: qId,
          type: type,
          correctIndices: [],
          displayTexts: [],
          blankTexts: [],
          imageUrls: [],
          revealed: true,
        };

        const options = question.options || [];

        if (type === "MCQ" || type === "MSQ" || type === "IS" || type === "ORDER") {
          // Collect correct indices
          if (typeof answerVal === "number" && answerVal >= 0) {
            cached.correctIndices.push(answerVal);
          } else if (Array.isArray(answerVal)) {
            answerVal.forEach((idx: number) => {
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
        } else if (type === "BLANK" || type === "OPEN") {
          if (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "object") {
            const optMap = new Map<string, string>();
            options.forEach((o: any) => { if (o.id || o._id) optMap.set(o.id || o._id, stripHtml(o.text)); });

            (answerVal as Array<{targetId: string; optionId: string[]}>).forEach((a) => {
              a.optionId?.forEach((oid) => {
                const txt = optMap.get(oid);
                if (txt && txt.length > 0) {
                  cached.blankTexts.push(txt);
                  cached.displayTexts.push(txt);
                }
              });
            });
          }

          // Fallback
          if (cached.blankTexts.length === 0) {
            options.forEach((o: any) => {
              const txt = stripHtml(o.text || "");
              if (txt) {
                cached.blankTexts.push(txt);
                cached.displayTexts.push(txt);
              }
            });
          }
        }

        STATE.answers.set(qId, cached);
        captured++;
        LOG.success(`Captured answer for ${qId}: ${JSON.stringify(cached.correctIndices)} / ${cached.displayTexts.join(", ")}`);
      }
    }

    if (captured > 0) {
      LOG.success(`Captured ${captured} revealed answers (total: ${STATE.answers.size})`);
    }
    return captured;
  },

  /**
   * Process current question — highlight correct answer if cached,
   * or sacrifice to reveal if not cached.
   */
  processQuestion(qId: string): boolean {
    const cached = STATE.answers.get(qId);
    const type = Pinia.getType(qId);
    const qState = Pinia.getQuestionState(qId);

    // Get question text
    const qText = stripHtml(Pinia.getText(qId));

    // If answer is already revealed in store (question was answered)
    const answerVal = Pinia.getAnswer(qId);
    const isRevealedInStore = (type === "MCQ" || type === "MSQ")
      ? (typeof answerVal === "number" && answerVal >= 0) || (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "number" && answerVal[0] >= 0)
      : qState === "reveal";

    // Capture any revealed answers
    this.captureRevealedAnswers();

    // CASE 1: We have cached answer from previous play
    if (cached?.revealed && cached.correctIndices.length > 0) {
      DOM.clearHighlights();

      let answerDisplay = "—";
      if (cached.displayTexts.length > 0) {
        answerDisplay = cached.displayTexts.join(" / ");
      } else if (cached.imageUrls.length > 0) {
        answerDisplay = `Opsi gambar ${cached.correctIndices.map(i => `#${i + 1}`).join(", ")}`;
      } else if (cached.blankTexts.length > 0) {
        answerDisplay = cached.blankTexts.join(" / ");
      }

      Panel.updateQuestion(qText, type);
      Panel.updateAnswer(answerDisplay);
      Panel.updateStatus(`Jawaban dari cache ✓`, "ok");

      // Highlight correct options in DOM
      if (type !== "BLANK" && type !== "OPEN") {
        this.highlightCachedAnswer(cached);
      }

      STATE.lastHighlightQId = qId;
      STATE.phase = "revealed";
      return true;
    }

    // CASE 2: Answer is revealed in current store (we just answered it)
    if (isRevealedInStore) {
      DOM.clearHighlights();

      const freshCached = STATE.answers.get(qId);
      if (freshCached?.revealed) {
        let answerDisplay = "—";
        if (freshCached.displayTexts.length > 0) {
          answerDisplay = freshCached.displayTexts.join(" / ");
        } else if (freshCached.blankTexts.length > 0) {
          answerDisplay = freshCached.blankTexts.join(" / ");
        }

        Panel.updateQuestion(qText, type);
        Panel.updateAnswer(answerDisplay);
        Panel.updateStatus(`Jawaban terungkap ✓`, "ok");

        if (type !== "BLANK" && type !== "OPEN") {
          this.highlightCachedAnswer(freshCached);
        }

        STATE.lastHighlightQId = qId;
        STATE.phase = "revealed";
        return true;
      }
    }

    // CASE 3: No cached answer — sacrifice to reveal
    if (!cached?.revealed && !isRevealedInStore && STATE.autoSacrifice && !STATE.sacrificing) {
      STATE.sacrificing = true;
      STATE.phase = "sacrificing";

      Panel.updateQuestion(qText, type);
      Panel.updateAnswer("Menunggu reveal...");
      Panel.updateStatus("Sacrifice — mengungkap jawaban...", "loading");

      // Wait a bit for DOM to be ready, then sacrifice
      setTimeout(() => {
        const success = DOM.clickFirstOption();
        if (!success) {
          LOG.warn("Sacrifice failed — no options to click");
        }
        // After sacrifice, we need to wait for reveal
        // The polling loop will detect the state change
      }, 300);

      return true; // Return true so we don't retry
    }

    // CASE 4: Not sacrificing, waiting for manual answer
    if (!STATE.autoSacrifice) {
      Panel.updateQuestion(qText, type);
      Panel.updateAnswer("Aktifkan Sacrifice otomatis");
      Panel.updateStatus("Menunggu sacrifice...", "loading");
      return true;
    }

    return false;
  },

  /** Highlight correct options using cached answer data */
  highlightCachedAnswer(cached: CachedAnswer): boolean {
    const allOptions = DOM.getOptions();
    if (allOptions.length === 0) {
      LOG.warn("No option elements found in DOM");
      return false;
    }

    // METHOD 1: data-cy="option-N" — BULLETPROOF, uses API index
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

    // METHOD 4: Numeric comparison
    if (correctEls.length === 0 && cached.displayTexts.length > 0) {
      allOptions.forEach((el) => {
        const elNum = parseFloat(stripHtml(el.textContent || "").replace(/[^\d.\-]/g, ""));
        for (const ct of cached.displayTexts) {
          const ctNum = parseFloat(ct.replace(/[^\d.\-]/g, ""));
          if (!isNaN(elNum) && !isNaN(ctNum) && Math.abs(elNum - ctNum) < 0.01) {
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
        if (correctSet.has(el)) {
          DOM.highlightCorrect(el);
        } else if (STATE.dimWrong) {
          DOM.dimWrong(el);
        }
      });

      LOG.success(`Highlighted ${correctEls.length} correct / ${allOptions.length} total`);
      return true;
    }

    LOG.warn("Could not match any correct option in DOM");
    return false;
  },

  /** Main tick — called every 200ms */
  tick(): void {
    if (!STATE.inGame) return;

    const qId = Pinia.currentQId;
    if (!qId) return;

    // Capture any newly revealed answers
    this.captureRevealedAnswers();

    // Check if sacrificing just completed (state changed to reveal)
    if (STATE.sacrificing) {
      const qState = Pinia.getQuestionState(qId);
      const answerVal = Pinia.getAnswer(qId);
      const type = Pinia.getType(qId);

      const isNowRevealed = (type === "MCQ" || type === "MSQ")
        ? (typeof answerVal === "number" && answerVal >= 0) || (Array.isArray(answerVal) && answerVal.length > 0 && typeof answerVal[0] === "number" && answerVal[0] >= 0)
        : qState === "reveal";

      if (isNowRevealed) {
        STATE.sacrificing = false;
        LOG.success(`Sacrifice complete — answer revealed for ${qId}`);
        // Process the revealed answer
        this.captureRevealedAnswers();
      }
    }

    // Detect question change
    if (qId !== STATE.currentQId) {
      STATE.currentQId = qId;
      STATE.sacrificing = false;
      STATE.retryCount = 0;
      STATE.phase = "waiting";

      // Count answered questions
      STATE.answeredQ = Pinia.doneOrder.length;
      LOG.info(`New question: ${qId} (${STATE.answeredQ}/${STATE.totalQ} done)`);

      // Try processing
      const tryProcess = () => {
        if (STATE.retryCount >= STATE.maxRetries) {
          LOG.warn(`Gave up after ${STATE.maxRetries} retries`);
          return;
        }

        const success = this.processQuestion(qId);
        if (!success) {
          STATE.retryCount++;
          LOG.info(`Retry ${STATE.retryCount}/${STATE.maxRetries} in 500ms`);
          setTimeout(tryProcess, 500);
        } else {
          STATE.retryCount = 0;
        }
      };

      tryProcess();
      Panel.updateStats();
    }
  },

  /** Start the polling loop */
  startPolling(): void {
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollTimer = setInterval(() => this.tick(), 200);
    LOG.info("Polling started (200ms)");

    this.setupDOMWatcher();
  },

  /** Watch for DOM mutations that remove our highlights */
  setupDOMWatcher(): void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let reapplyCount = 0;
    const MAX_REAPPLY = 3;

    const observer = new MutationObserver((mutations) => {
      if (!STATE.lastHighlightQId) return;
      if (!Pinia.inGame) return;

      const cached = STATE.answers.get(STATE.lastHighlightQId);
      if (cached && (cached.type === "BLANK" || cached.type === "OPEN")) return;

      const relevant = mutations.some((m) => {
        if (m.type === "attributes") {
          const target = m.target as HTMLElement;
          if (m.attributeName === "data-wg-correct" || m.attributeName === "data-wg-wrong" || m.attributeName === "style") return false;
          if (target.hasAttribute?.("role") && target.getAttribute("role") === "option") return true;
          return false;
        }
        return m.type === "childList";
      });

      if (!relevant) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const hasHighlights = document.querySelector("[data-wg-correct]");
        if (!hasHighlights && reapplyCount < MAX_REAPPLY) {
          reapplyCount++;
          LOG.info(`Highlights lost, re-applying (${reapplyCount}/${MAX_REAPPLY})...`);
          STATE.lastHighlightQId = "";
          const currentQId = Pinia.currentQId;
          if (currentQId) {
            this.processQuestion(currentQId);
          }
        }
      }, 300);
    });

    const originalTick = this.tick.bind(this);
    this.tick = () => {
      reapplyCount = 0;
      originalTick();
    };

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  },

  /** Stop everything */
  stop(): void {
    if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; }
    DOM.clearHighlights();
    STATE.inGame = false;
    STATE.answers.clear();
    STATE.currentQId = "";
    STATE.prevQId = "";
    STATE.lastHighlightQId = "";
    STATE.totalQ = 0;
    STATE.answeredQ = 0;
    STATE.correctQ = 0;
    STATE.sacrificing = false;
    STATE.phase = "waiting";
    LOG.always("Stopped");
  },
};

// ═══════════════════════════════════════════
//  PANEL — VVIP FLOATING UI (sama dengan WG)
// ═══════════════════════════════════════════

const Panel = {
  create(): void {
    if (STATE.panel) return;

    const el = document.createElement("div");
    el.id = "wg-panel";
    el.classList.add("ghost"); // Mulai dalam ghost mode
    el.innerHTML = `
      <div id="wg-header">
        <div id="wg-logo">
          <span id="wg-logo-sub">ELITE</span>
        </div>
        <div id="wg-header-actions">
          <button id="wg-btn-reload" title="Muat ulang jawaban">&#x21bb;</button>
          <button id="wg-btn-minimize" title="Perkecil">&#x2500;</button>
        </div>
      </div>
      <div id="wg-body">
        <div id="wg-status">
          <span id="wg-status-dot"></span>
          <span id="wg-status-text">Memulai...</span>
        </div>
        <div id="wg-question"></div>
        <div id="wg-answer"></div>
        <div id="wg-divider"></div>
        <div id="wg-controls">
          <label class="wg-toggle">
            <input type="checkbox" id="wg-auto" checked />
            <span class="wg-slider"></span>
            <span class="wg-label">Sacrifice Otomatis</span>
          </label>
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

      #wg-panel {
        position: fixed; top: 12px; right: 12px; z-index: 999999;
        font-family: 'Inter', -apple-system, system-ui, sans-serif;
        font-size: 13px; color: ${T.text};
        background: ${T.bgGradient};
        border: 1px solid ${T.border};
        border-radius: ${T.radius}; width: 280px;
        box-shadow: ${T.shadow};
        backdrop-filter: blur(20px); user-select: none;
        overflow: hidden;
        transition: opacity 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease;
        animation: wgSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* ═══ GHOST MODE ═══ */
      #wg-panel.ghost {
        width: auto;
        border-radius: 8px;
        background: none !important;
        backdrop-filter: none !important;
        box-shadow: none !important;
        border: none !important;
      }
      #wg-panel.ghost #wg-body { display: none; }
      #wg-panel.ghost #wg-logo { display: none; }
      #wg-panel.ghost #wg-btn-reload { display: none; }
      #wg-panel.ghost #wg-header {
        padding: 0;
        background: none !important;
        border-bottom: none !important;
        border-radius: 8px;
        margin: 0;
      }
      #wg-panel.ghost #wg-header-actions {
        gap: 0;
        background: none !important;
      }
      #wg-panel.ghost #wg-btn-minimize {
        opacity: 0.4;
        border: none !important;
        font-size: 14px;
        padding: 4px 10px;
        background: none !important;
        color: rgba(100,100,100,0.9);
        border-radius: 8px;
        pointer-events: auto;
        cursor: pointer;
        outline: none;
      }
      #wg-panel.ghost #wg-btn-minimize:hover {
        opacity: 1;
        color: rgba(60,60,60,1);
      }
      #wg-panel:not(.ghost) {
        width: 280px;
        pointer-events: auto;
      }

      @keyframes wgSlideIn {
        from { opacity: 0; transform: translateY(-20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      #wg-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px;
        background: linear-gradient(135deg, ${T.navyLight}44, ${T.navy}22);
        border-bottom: 1px solid ${T.border};
      }

      #wg-logo { display: flex; align-items: baseline; gap: 5px; }
      #wg-logo-sub {
        font-weight: 800; font-size: 16px; color: ${T.gold};
        letter-spacing: 5px; opacity: 1;
        text-shadow: 0 0 12px ${T.gold}80;
      }

      #wg-header-actions { display: flex; gap: 4px; }
      #wg-header-actions button {
        background: none; border: 1px solid ${T.border}; color: ${T.textDim};
        cursor: pointer; font-size: 12px; padding: 2px 8px;
        border-radius: 6px; transition: all 0.2s; line-height: 1.2;
      }
      #wg-header-actions button:hover {
        color: ${T.accent}; border-color: ${T.borderAccent};
        background: ${T.accentDim};
      }

      #wg-body { padding: 12px 14px; }

      #wg-status { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      #wg-status-dot {
        width: 7px; height: 7px; border-radius: 50%; background: #555;
        flex-shrink: 0; transition: background 0.3s;
      }
      #wg-status.ok #wg-status-dot { background: #00e676; box-shadow: 0 0 8px #00e67666; }
      #wg-status.err #wg-status-dot { background: ${T.red}; box-shadow: 0 0 8px ${T.red}66; }
      #wg-status.loading #wg-status-dot { background: ${T.gold}; animation: wgPulse 1s infinite; }
      @keyframes wgPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      #wg-status-text { font-size: 11px; color: ${T.textDim}; }

      #wg-question {
        font-size: 11px; color: ${T.textMuted}; margin-bottom: 6px;
        max-height: 40px; overflow: hidden; line-height: 1.4;
      }

      #wg-answer {
        font-size: 14px; font-weight: 700; color: ${T.gold};
        margin: 8px 0; padding: 10px 12px;
        background: ${T.goldDim};
        border-radius: 8px; border-left: 3px solid ${T.gold};
        max-height: 80px; overflow-y: auto; word-break: break-word;
        line-height: 1.3;
      }

      #wg-divider {
        height: 1px; background: ${T.border}; margin: 10px 0;
      }

      #wg-controls { display: flex; flex-direction: column; gap: 6px; }

      .wg-toggle {
        display: flex; align-items: center; gap: 8px;
        cursor: pointer; font-size: 11px; color: ${T.textDim};
      }
      .wg-toggle input { display: none; }
      .wg-slider {
        position: relative; width: 32px; height: 16px;
        background: ${T.navyLight}; border-radius: 8px;
        transition: all 0.3s; flex-shrink: 0;
        border: 1px solid ${T.border};
      }
      .wg-slider::after {
        content: ''; position: absolute; top: 2px; left: 2px;
        width: 10px; height: 10px; border-radius: 50%;
        background: ${T.textDim}; transition: all 0.3s;
      }
      .wg-toggle input:checked + .wg-slider {
        background: ${T.accent}; border-color: ${T.accent};
      }
      .wg-toggle input:checked + .wg-slider::after {
        transform: translateX(16px); background: white;
      }
      .wg-label { transition: color 0.2s; }
      .wg-toggle:hover .wg-label { color: ${T.textMuted}; }

      #wg-stats {
        font-size: 10px; color: ${T.textDim}; margin-top: 8px;
        display: flex; justify-content: space-between;
      }

      /* Custom scrollbar */
      #wg-answer::-webkit-scrollbar { width: 4px; }
      #wg-answer::-webkit-scrollbar-track { background: transparent; }
      #wg-answer::-webkit-scrollbar-thumb { background: ${T.navyGlow}; border-radius: 2px; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(el);
    STATE.panel = el;
    STATE.style = style;

    // Make draggable
    this.setupDrag(el);

    // Wire up controls — tombol - toggle ghost mode
    el.querySelector("#wg-btn-minimize")!.addEventListener("click", () => {
      el.classList.toggle("ghost");
    });

    el.querySelector("#wg-btn-reload")!.addEventListener("click", () => {
      // Force re-capture all revealed answers
      Engine.captureRevealedAnswers();
      if (STATE.roomHash) AnswerCache.save(STATE.roomHash);
      this.updateStatus(`${STATE.answers.size} jawaban tercatat`, "ok");
    });

    el.querySelector("#wg-auto")!.addEventListener("change", (e) => {
      STATE.autoSacrifice = (e.target as HTMLInputElement).checked;
      LOG.info(`Auto-Sacrifice: ${STATE.autoSacrifice ? "ON" : "OFF"}`);
    });

    el.querySelector("#wg-dim")!.addEventListener("change", (e) => {
      STATE.dimWrong = (e.target as HTMLInputElement).checked;
      LOG.info(`Dim Wrong: ${STATE.dimWrong ? "ON" : "OFF"}`);
    });

    el.querySelector("#wg-debug")!.addEventListener("change", (e) => {
      STATE.debug = (e.target as HTMLInputElement).checked;
      LOG.info(`Debug: ${STATE.debug ? "ON" : "OFF"}`);
    });
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
    if (el) {
      el.className = type;
      const textEl = el.querySelector("#wg-status-text");
      if (textEl) textEl.textContent = text;
    }
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
      const gq = Pinia.state("gameQuestions");
      const doneCount = gq?.doneOrder?.length || STATE.answeredQ;
      const cachedCount = STATE.answers.size;
      const revealedCount = Array.from(STATE.answers.values()).filter(a => a.revealed).length;
      el.innerHTML = `<span>${doneCount}/${STATE.totalQ} dijawab</span><span>${revealedCount} terungkap</span>`;
    }
  },

  destroy(): void {
    if (STATE.panel) { STATE.panel.remove(); STATE.panel = null; }
    if (STATE.style) { STATE.style.remove(); STATE.style = null; }
  },
};

// ═══════════════════════════════════════════
//  BOOT — MAIN ENTRY POINT
// ═══════════════════════════════════════════

const Boot = {
  async start(): Promise<void> {
    LOG.always("Starting CheatWG v1.0 (Join Code Mode)...");

    Panel.create();
    Panel.updateStatus("Menunggu permainan...", "loading");

    // Wait for game to start (up to 60s)
    for (let i = 0; i < 60; i++) {
      if (Pinia.inGame) break;
      await new Promise((r) => setTimeout(r, 1000));
      Panel.updateStatus(`Menunggu permainan... (${i + 1}d)`, "loading");
    }

    if (!Pinia.inGame) {
      Panel.updateStatus("Permainan tidak ditemukan — masuk ke permainan dulu!", "err");
      return;
    }

    // Get game info
    STATE.roomHash = Pinia.roomHash || "";
    STATE.roomCode = Pinia.roomCode || "";
    STATE.inGame = true;
    STATE.totalQ = Pinia.state("gameData")?.totalQuestionsInQuiz || Object.keys(Pinia.questionList).length;

    LOG.success(`Game detected! Room: ${STATE.roomCode}, Hash: ${STATE.roomHash}, Questions: ${STATE.totalQ}`);

    // Try loading cached answers from previous plays
    const cachedCount = AnswerCache.load(STATE.roomHash);
    if (cachedCount > 0) {
      Panel.updateStatus(`${cachedCount} jawaban dari cache sebelumnya`, "ok");
      LOG.success(`Using ${cachedCount} cached answers from previous play!`);
    } else {
      Panel.updateStatus("Tidak ada cache — menggunakan sacrifice mode", "loading");
    }

    Panel.updateStats();

    // Start auto-save
    AnswerCache.startAutoSave();

    // Start polling
    Engine.startPolling();

    // Process current question immediately
    const qId = Pinia.currentQId;
    if (qId) {
      STATE.currentQId = qId;
      Engine.processQuestion(qId);
    }

    LOG.success("CheatWG v1.0 ready!");
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
    get autoSacrifice() { return STATE.autoSacrifice; },
    set autoSacrifice(v) { STATE.autoSacrifice = v; },
    get dimWrong() { return STATE.dimWrong; },
    set dimWrong(v) { STATE.dimWrong = v; },
    get debug() { return STATE.debug; },
    set debug(v) { STATE.debug = v; },
  },
  cache: () => STATE.answers,
  stats: () => ({
    total: STATE.totalQ,
    answered: STATE.answeredQ,
    revealed: Array.from(STATE.answers.values()).filter(a => a.revealed).length,
    phase: STATE.phase,
  }),
};

Boot.start();
