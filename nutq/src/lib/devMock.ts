/**
 * Browser-only stand-in for the Rust backend.
 *
 * Lets `npm run dev` render the full UI in a normal browser so layout and
 * styling can be iterated without a Rust rebuild. It is reached only when
 * `import.meta.env.DEV` is true AND the Tauri bridge is absent, so Vite drops
 * this whole module from production builds and the real app can never
 * accidentally fall through to fake data.
 */

const settings = {
  hotkey: "F8",
  draft_hotkey: "CmdOrControl+F8",
  mode: "natural",
  output: "instant",
  microphone: "Default",
  profiles: [
    {
      id: "dictate",
      name: "Dictation",
      hotkey: "F8",
      output: "instant",
      mode: "natural",
      custom_prompt: "",
      stt_override: false,
      stt_provider: "gemini",
      stt_model: "gemini-3.5-flash",
      refine_override: false,
      refine_provider: "anthropic",
      refine_model: "claude-opus-5",
      refine_skip: false,
    },
    {
      id: "verbatim",
      name: "Proofread",
      hotkey: "CmdOrControl+F8",
      output: "instant",
      mode: "verbatim",
      custom_prompt: "",
      stt_override: false,
      stt_provider: "gemini",
      stt_model: "gemini-3.5-flash",
      refine_override: false,
      refine_provider: "anthropic",
      refine_model: "claude-opus-5",
      refine_skip: false,
    },
    {
      id: "checklist",
      name: "Checklist",
      hotkey: "CmdOrControl+F9",
      output: "instant",
      mode: "checklist",
      custom_prompt: "",
      stt_override: false,
      stt_provider: "gemini",
      stt_model: "gemini-3.5-flash",
      refine_override: false,
      refine_provider: "anthropic",
      refine_model: "claude-opus-5",
      refine_skip: false,
    },
    {
      id: "spec",
      name: "Idea → Spec",
      hotkey: "CmdOrControl+F10",
      output: "draft",
      mode: "spec",
      custom_prompt: "",
      stt_override: false,
      stt_provider: "gemini",
      stt_model: "gemini-3.5-flash",
      refine_override: false,
      refine_provider: "anthropic",
      refine_model: "claude-opus-5",
      refine_skip: false,
    },
  ],
  stt_provider: "gemini",
  stt_model: "gemini-3.5-flash",
  stt_base_url: "https://api.groq.com/openai/v1",
  refine_provider: "anthropic",
  refine_model: "claude-opus-5",
  refine_base_url: "https://open.bigmodel.cn/api/paas/v4",
  refine_enabled: true,
  language_hint: "Arabic (Levantine dialect) mixed with English technical terms",
  dictionary: [{ from: "towry", to: "Tauri" }],
  snippets: [],
  play_sounds: false,
  save_audio: true,
  overlay_glow_inner: true,
  overlay_glow_outer: true,
  overlay_theme: "teal_night",
  overlay_aura_color: "#2fd6a5",
  overlay_bg: "#12161d",
  overlay_style: "bars",
};

/** Enough entries to push the History page past two pages of ten, spread over
 * the past three months so every chart range filter has something to draw,
 * with a few today so the hour-by-hour Day view has bars too. Dates are
 * relative to today so the chart's window always contains them. */
const dayStr = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const history = Array.from({ length: 23 }, (_, i) => ({
  id: String(i + 1),
  at: `${dayStr(i < 3 ? 0 : Math.floor(((i - 3) * 86) / 20))} ${String(9 + (i * 5) % 12).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:05`,
  mode: (["natural", "spec", "summary", "verbatim"] as const)[i % 4],
  raw: "يعني الفكرة اني بدي اعمل برنامج، آه، زي هاندي بس احسن...",
  refined:
    i % 4 === 1
      ? "الهدف\nتطبيق إملاء صوتي لويندوز يحوّل الكلام إلى نص منقّح جاهز للاستخدام.\n\nالمتطلبات\n- اختصار عام يشتغل في أي تطبيق\n- تفريغ عبر API سحابي بدل نموذج محلي"
      : "تطبيق إملاء صوتي لويندوز يحوّل الكلام إلى نص منقّح جاهز للاستخدام، باختصار عام يعمل في أي تطبيق، وتفريغ سحابي بدل نموذج محلي.",
  seconds: 18 + ((i * 37) % 120),
  cost_usd: 0.00218,
  microphone: "Microphone (Realtek Audio)",
  audio_file: i === 0 ? "1.wav" : null,
  stt_model: (["whisper-large-v3", "gemini-3.5-flash", "scribe_v1"] as const)[i % 3],
}));

/** Folds one bucket's per-model map into the same shape the Rust command
 *  returns: totals plus the slices they add up to. */
function finish(
  label: string,
  m: Map<string, { count: number; seconds: number }>,
) {
  let count = 0;
  let seconds = 0;
  const models: { model: string; count: number; seconds: number }[] = [];
  for (const [model, s] of m) {
    models.push({ model, ...s });
    count += s.count;
    seconds += s.seconds;
  }
  return { label, count, seconds, models };
}

/** Mirrors the Rust command: "day" is one bucket per hour of today, the rest
 * are trailing whole days, zero-filled either way, each bucket split per
 * STT model. */
function statsFrom(es: typeof history, range: string) {
  if (range === "day") {
    const today = dayStr(0);
    const buckets = Array.from(
      { length: 24 },
      () => new Map<string, { count: number; seconds: number }>(),
    );
    for (const e of es) {
      if (!e.at.startsWith(today)) continue;
      const h = Number(e.at.slice(11, 13));
      const s = buckets[h].get(e.stt_model) ?? { count: 0, seconds: 0 };
      s.count += 1;
      s.seconds += e.seconds;
      buckets[h].set(e.stt_model, s);
    }
    return buckets.map((m, h) => finish(`${String(h).padStart(2, "0")}:00`, m));
  }
  const days = range === "week" ? 7 : range === "month" ? 30 : 90;
  const byDay = new Map<string, Map<string, { count: number; seconds: number }>>();
  for (const e of es) {
    const d = e.at.slice(0, 10);
    const m = byDay.get(d) ?? new Map<string, { count: number; seconds: number }>();
    const s = m.get(e.stt_model) ?? { count: 0, seconds: 0 };
    s.count += 1;
    s.seconds += e.seconds;
    m.set(e.stt_model, s);
    byDay.set(d, m);
  }
  const out: ReturnType<typeof finish>[] = [];
  for (let back = days - 1; back >= 0; back--) {
    out.push(finish(dayStr(back), byDay.get(dayStr(back)) ?? new Map()));
  }
  return out;
}

const logs = [
  {
    id: "1",
    at: "2026-09-08 17:26:00",
    level: "warning",
    message:
      "Transcription failed, trying the backup provider: Stage 1 (transcription) could not reach the endpoint - the server did not respond in time.\n\nCalled: https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
  },
  {
    id: "2",
    at: "2026-09-08 17:24:00",
    level: "error",
    message:
      "Transcription failed on every provider. The recording was saved - retry it from the Pending list on the Home page.",
  },
];

const responses: Record<string, unknown> = {
  get_settings: settings,
  key_status: {
    gemini: true,
    anthropic: true,
    elevenlabs: false,
    stt_custom: false,
    refine_custom: false,
  },
  list_microphones: ["Default", "Microphone (Realtek Audio)"],
  get_history: () => [...history],
  get_latest: () => history[0] ?? null,
  get_history_stats: ({ range }: { range: string }) =>
    statsFrom(history, typeof range === "string" ? range : "week"),
  get_logs: () => [...logs],
  clear_logs: () => {
    logs.length = 0;
    return null;
  },
  get_usage: {
    month_cost: 0.0413,
    month_count: 19,
    today_count: 113,
    today_audio_seconds: 1712,
    cost_complete: true,
  },
  get_status: "idle",
  get_pending: [],
  get_quota: [
    {
      host: "api.groq.com",
      at: "05:31:02",
      sent_this_session: 26,
      sent_today: 113,
      items: [{ kind: "requests", limit: "2000", remaining: "1999", reset: "43.2s" }],
    },
    {
      host: "generativelanguage.googleapis.com",
      at: "05:31:01",
      sent_this_session: 26,
      sent_today: 113,
      items: [],
    },
  ],
  check_hotkey: null,
  hotkey_status: [
    { profile_id: "dictate", name: "Dictation", state: { spec: "F8", bound: true, error: "", reset_from: "" } },
    { profile_id: "verbatim", name: "Proofread", state: { spec: "CmdOrControl+F8", bound: true, error: "", reset_from: "" } },
    { profile_id: "checklist", name: "Checklist", state: { spec: "CmdOrControl+F9", bound: true, error: "", reset_from: "" } },
    { profile_id: "spec", name: "Idea → Spec", state: { spec: "CmdOrControl+F10", bound: true, error: "", reset_from: "" } },
  ],
  get_todos: [
    {
      id: "1",
      at: "2026-09-08 09:14:22",
      title: "صباح اليوم",
      items: [
        { text: "مراجعة تقرير المبيعات", done: false },
        { text: "الاتصال بالمورد بخصوص الفاتورة", done: true },
        { text: "حجز اجتماع الفريق الساعة ٣", done: false },
      ],
    },
  ],
  toggle_todo: null,
  add_todo_item: null,
  remove_todo_item: null,
  delete_todo_list: null,
  get_notes: [
    {
      id: "1",
      at: "2026-09-08 11:02:10",
      kind: "idea",
      title: "فكرة: وضع الليل التلقائي",
      text: "فكرة: وضع ليلي تلقائي حسب إضاءة الشاشة\n\n- يقرأ سطوع الشاشة كل دقيقة\n- يبدّل ثيم الحبة والواجهة معاً",
      profile: "Ideas",
    },
    {
      id: "2",
      at: "2026-09-08 09:40:33",
      kind: "cleaned",
      title: "",
      text: "ملاحظة اجتماع اليوم: التسليم نهاية الأسبوع، والتصميم يحتاج مراجعة واحدة قبل الإرسال.",
      profile: "Notes",
    },
  ],
  update_note: null,
  set_note_kind: null,
  delete_note: null,
  update_settings: null,
  set_api_key: null,
  clear_history: () => {
    history.length = 0;
    return null;
  },
  delete_history_entry: ({ id }: { id: string }) => {
    const i = history.findIndex((e) => e.id === id);
    if (i >= 0) history.splice(i, 1);
    return null;
  },
  regenerate_history_entry: ({ id }: { id: string }) => {
    const e = history.find((e) => e.id === id);
    if (!e) throw new Error("this entry no longer exists");
    e.refined = `${e.refined}\n(معاد توليده ${new Date().toLocaleTimeString()})`;
    return { ...e };
  },
  copy_text: null,
  toggle: null,
  list_models: ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.5-pro"],
  test_provider: {
    ok: false,
    message:
      "Stage 2 (refinement): the endpoint is reachable but refused the key. This is a credential problem, not a URL problem - fix the \"Refinement endpoint\" key.\n\nIt said: Invalid API key\n\nCalled: https://api.z.ai/api/paas/v4/chat/completions",
  },
};

export const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const useMock = () => import.meta.env.DEV && !isTauri();

export async function mockInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!(cmd in responses)) throw new Error(`no mock for command: ${cmd}`);
  const v = responses[cmd];
  // Commands that need the arguments get a function; everything else is a
  // plain value returned as-is.
  return (typeof v === "function" ? v(args) : v) as T;
}
