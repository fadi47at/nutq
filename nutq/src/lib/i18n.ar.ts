/**
 * The Arabic interface: English source text -> Arabic.
 *
 * Keys are the exact English strings passed to `t()` (see i18n.ts), so a key
 * that drifts from its call site stops matching and the English shows instead -
 * `npm run i18n:check` catches both directions. `{placeholders}` must survive
 * translation unchanged; their position is free.
 *
 * Voice: plain Modern Standard Arabic, short, the way a well-made Arabic app
 * speaks - not a word-for-word copy of the English. Terms are fixed across the
 * app: line = خط، hotkey = اختصار، transcription = التفريغ، refinement =
 * التنقيح، provider = المزوّد، model = النموذج، recording pill = مؤشر التسجيل.
 * Product names (Gemini, Claude, API, URL) stay in Latin letters.
 */
export const AR: Record<string, string> = {
  // ---------------------------------------------------------------- shell
  "voice to text": "من الصوت إلى النص",
  Workspace: "مساحة العمل",
  App: "التطبيق",
  Home: "الرئيسية",
  Notes: "الملاحظات",
  "To-do": "المهام",
  History: "السجل",
  Settings: "الإعدادات",
  Logs: "التنبيهات",
  idle: "جاهز",
  recording: "يسجّل",
  transcribing: "يفرّغ",
  refining: "ينقّح",
  "waiting for your hotkey": "بانتظار اختصارك",
  listening: "يستمع",
  warning: "تحذير",
  error: "خطأ",
  Update: "تحديث",
  "A new version is available: v{version}.": "يتوفر إصدار جديد: v{version}.",
  Details: "التفاصيل",
  Dismiss: "إخفاء",
  Copy: "نسخ",
  Copied: "نُسخ",
  "version {v}": "الإصدار {v}",
  "Open settings": "افتح الإعدادات",
  "Add the key": "أضف المفتاح",
  'Your "{name}" hotkey "{from}" was not a key this app could bind, so it was reset to {to}. Set the one you want in Settings.':
    "اختصار «{name}» المحفوظ «{from}» لا يمكن ربطه، فأُعيد إلى {to}. اختر الاختصار الذي تريده من الإعدادات.",
  'The "{name}" hotkey {key} is not active.': "اختصار «{name}» ({key}) غير مفعّل.",
  "No API key saved for the transcription provider you selected. Nothing can be transcribed until one is.":
    "لا يوجد مفتاح API محفوظ لمزوّد التفريغ الذي اخترته. لن يُفرَّغ أي تسجيل حتى تضيفه.",
  "Refinement is on but no API key is saved for its provider.":
    "التنقيح مفعّل، لكن لا يوجد مفتاح API محفوظ لمزوّده.",

  // ------------------------------------------------------- modes & kinds
  Natural: "طبيعي",
  "Filler and false starts removed": "بلا حشو ولا بدايات متعثّرة",
  Verbatim: "حرفي",
  "Exactly as spoken, punctuation fixed": "كما قيل تمامًا، مع تصحيح الترقيم",
  Spec: "مواصفات",
  "Rambling idea to a structured brief": "فكرة مسترسلة تتحول إلى موجز منظَّم",
  Summary: "ملخّص",
  "Tight bullet points": "نقاط مركّزة",
  Checklist: "قائمة مهام",
  "Spoken ramble to a tickable to-do list": "كلام مسترسل يتحول إلى قائمة مهام قابلة للتأشير",
  Dictation: "إملاء",
  Note: "ملاحظة",
  Idea: "فكرة",
  "Word for word": "كلمة بكلمة",
  "Your own instructions": "تعليماتك الخاصة",

  // ------------------------------------------------------------ providers
  "Any OpenAI-compatible endpoint": "أي خادم متوافق مع OpenAI",
  "Best on Levantine Arabic mixed with English. Takes audio directly.":
    "الأفضل مع العربية الشامية الممزوجة بالإنجليزية. يستقبل الصوت مباشرة.",
  "Purpose-built transcriber, strong multilingual accuracy.":
    "مُفرِّغ متخصص، بدقة عالية في لغات كثيرة.",
  "POST {base}/audio/transcriptions — OpenAI, Groq, a local whisper server.":
    "POST {base}/audio/transcriptions — ‏OpenAI أو Groq أو خادم whisper محلي.",
  "The official Anthropic API, or an Anthropic-compatible base URL (GLM's coding endpoint).":
    "واجهة Anthropic الرسمية، أو عنوان متوافق معها (مثل خادم GLM للبرمجة).",
  "Reuses the Gemini key, so one provider covers both stages.":
    "يستخدم مفتاح Gemini نفسه، فيكفي مزوّد واحد للمرحلتين.",
  "POST {base}/chat/completions — GLM, DeepSeek, OpenRouter, Groq, local servers.":
    "POST {base}/chat/completions — ‏GLM أو DeepSeek أو OpenRouter أو Groq أو خوادم محلية.",
  "the update is gone - check again": "لم يعد التحديث متاحًا - تحقّق مرة أخرى",
  "not set": "غير محدد",

  // ------------------------------------------------------------- durations
  "{s}s": "{s} ث",
  "{m}m {s}s": "{m} د {s} ث",
  "{h}h {m}m": "{h} س {m} د",
  "{h}h": "{h} س",
  "{m}m": "{m} د",

  // ------------------------------------------------------------------ home
  "Voice workspace": "مساحتك الصوتية",
  "Ready when you are.": "جاهز متى ما كنت جاهزًا.",
  "Press a line's hotkey in any app, speak, and press it again. The finished text lands where that line sends it.":
    "اضغط اختصار أي خط في أي تطبيق، تكلّم، ثم اضغطه مرة ثانية. يصل النص الجاهز إلى حيث يرسله ذلك الخط.",
  "No dictation lines yet - add one in Settings and it gets a hotkey and a button here.":
    "لا توجد خطوط إملاء بعد - أضف خطًا من الإعدادات ليحصل على اختصار وزر هنا.",
  "A newer version is out": "صدر إصدار أحدث",
  "you have v{v}": "لديك v{v}",
  "Download, install, restart - all in one click.": "تنزيل وتثبيت وإعادة تشغيل - بنقرة واحدة.",
  "Downloading and installing…": "جارٍ التنزيل والتثبيت…",
  "Update now": "حدّث الآن",
  Later: "لاحقًا",
  "Waiting to be retried": "بانتظار إعادة المحاولة",
  "Calls that failed on every provider. Retrying uses the providers selected in Settings right now - fix anything there first, then retry.":
    "طلبات فشلت عند كل المزوّدين. إعادة المحاولة تستخدم المزوّدين المختارين في الإعدادات الآن - أصلح ما يلزم هناك أولًا، ثم أعد المحاولة.",
  Recording: "تسجيل",
  Transcript: "نص مفرَّغ",
  "Retrying…": "جارٍ إعادة المحاولة…",
  Retry: "أعد المحاولة",
  Discard: "تجاهل",
  Ready: "جاهز",
  "press a hotkey anywhere, or click a line": "اضغط اختصارًا من أي مكان، أو انقر خطًا",
  Listening: "يستمع",
  "press the same key again to finish": "اضغط المفتاح نفسه مرة ثانية للإنهاء",
  Transcribing: "يفرّغ",
  "sending the audio to the model": "يرسل الصوت إلى النموذج",
  Refining: "ينقّح",
  "turning the transcript into the finished text": "يحوّل النص المفرَّغ إلى نص جاهز",
  "Make your first line": "أنشئ خطك الأول",
  "A line is one hotkey plus what it does with your voice - dictation, a note, a checklist, your own instructions. It becomes a button here and a key that works in any app.":
    "الخط هو اختصار واحد وما يفعله بصوتك - إملاء، أو ملاحظة، أو قائمة مهام، أو تعليماتك الخاصة. يصبح زرًا هنا ومفتاحًا يعمل في أي تطبيق.",
  "Add your first line": "أضف خطك الأول",
  "custom instructions": "تعليمات خاصة",
  "pastes in place": "يلصق في مكانه",
  "waits here": "ينتظر هنا",
  "files a note": "يحفظ ملاحظة",
  "1 line": "خط واحد",
  "{n} lines": "الخطوط: {n}",
  "{n} today ({d} audio)": "اليوم: {n} ({d} صوت)",
  "${cost} this month · {n} results": "هذا الشهر: ${cost} · النتائج: {n}",
  "some providers untracked": "بعض المزوّدين بلا تتبّع للتكلفة",
  hear: "يسمع",
  // The flow arrow between two stages points the way the line is read.
  "→": "←",
  write: "يكتب",
  "raw transcript": "النص المفرَّغ كما هو",
  "Latest result": "آخر نتيجة",
  Audio: "الصوت",
  "Copy the recording as a file": "انسخ التسجيل كملف",
  "This entry no longer has its recording": "لم يعد تسجيل هذا الإدخال موجودًا",
  backup: "احتياطي",
  raw: "خام",
  "Your latest result will appear here.": "ستظهر آخر نتيجة لك هنا.",
  "{pct}% of today's allowance · {left} left right now · back to full in {reset}":
    "{pct}% من حصة اليوم · المتبقي الآن {left} · تمتلئ من جديد خلال {reset}",
  "{used} today": "اليوم: {used}",
  "{d} audio": "{d} صوت",
  "reported {at}": "آخر قراءة {at}",
  "{pct}% of today's allowance": "{pct}% من حصة اليوم",
  "only {left} left to send right now · back to full in {reset}":
    "بقي {left} فقط للإرسال الآن · تمتلئ من جديد خلال {reset}",

  // ----------------------------------------------------------------- notes
  "From your Notes and Ideas lines": "من خطَّي الملاحظات والأفكار",
  "Speak on a notes line and the result lands here instead of being pasted - notes and ideas you can come back to, search, and fix up.":
    "تكلّم على خط ملاحظات فتصل النتيجة إلى هنا بدل أن تُلصق - ملاحظات وأفكار ترجع إليها وتبحث فيها وتحسّنها.",
  "{n} kept": "المحفوظ: {n}",
  All: "الكل",
  Ideas: "الأفكار",
  "Search notes": "ابحث في الملاحظات",
  "No notes yet": "لا توجد ملاحظات بعد",
  "Nothing matches": "لا شيء يطابق",
  "Press a notes-line hotkey, speak, and the note appears here.":
    "اضغط اختصار خط الملاحظات، تكلّم، وستظهر الملاحظة هنا.",
  "Try a different word, or switch the filter back to All.": "جرّب كلمة أخرى، أو أعد التصفية إلى «الكل».",
  Cleaned: "منقّحة",
  "Filler removed, wording kept": "بلا حشو، مع الحفاظ على صياغتك",
  "As spoken": "كما قيلت",
  "Exactly what you said, punctuation fixed": "ما قلته بالضبط، مع تصحيح الترقيم",
  "A rambling thought, developed into structure": "فكرة مسترسلة صارت بنية واضحة",
  "via {line}": "عبر {line}",
  "Copy this note": "انسخ هذه الملاحظة",
  "Stop editing": "أنهِ التحرير",
  "Edit this note": "حرّر هذه الملاحظة",
  Delete: "احذف",
  Cancel: "إلغاء",
  "Delete this note": "احذف هذه الملاحظة",
  "Save note": "احفظ الملاحظة",

  // ----------------------------------------------------------------- to-do
  "From your Checklist line": "من خط قائمة المهام",
  "Speak your tasks on the Checklist line and they land here, ready to tick off. Items can also be typed in by hand.":
    "قل مهامك على خط قائمة المهام فتصل إلى هنا جاهزة للتأشير. ويمكنك أيضًا كتابة بنود بيدك.",
  "all done": "اكتمل الكل",
  "{n} open": "المفتوحة: {n}",
  "No lists yet": "لا توجد قوائم بعد",
  "Press the Checklist hotkey, talk through what needs doing, and the list appears here.":
    "اضغط اختصار قائمة المهام، تحدّث عمّا يجب إنجازه، وستظهر القائمة هنا.",
  "Delete list": "احذف القائمة",
  "Delete this list": "احذف هذه القائمة",
  "{done} of {total} done": "أُنجز {done} من {total}",
  "Mark as open": "علّمها كمفتوحة",
  "Mark as done": "علّمها كمنجزة",
  "Remove this item": "أزل هذا البند",
  "add a task by hand": "أضف مهمة بيدك",
  Add: "أضف",

  // ------------------------------------------------------------------ logs
  Diagnostics: "التشخيص",
  "Warnings and errors this app has run into, newest first, kept on this machine only. The newest of these is what the sidebar shows.":
    "التحذيرات والأخطاء التي واجهها التطبيق، الأحدث أولًا، محفوظة على هذا الجهاز فقط. أحدثها هو ما يظهر في الشريط الجانبي.",
  "Clear log": "امسح السجل",
  "{n} entries": "الإدخالات: {n}",
  "{n} errors": "الأخطاء: {n}",
  "no errors": "لا أخطاء",
  "Nothing logged": "لا شيء مسجَّل",
  "Quiet is good. Anything that goes wrong with a provider, a key, or a hotkey lands here.":
    "الهدوء علامة جيدة. أي مشكلة في مزوّد أو مفتاح أو اختصار ستظهر هنا.",
  "Copy this message": "انسخ هذه الرسالة",

  // --------------------------------------------------------------- history
  "Loading…": "جارٍ التحميل…",
  "Play the recording": "شغّل التسجيل",
  "/h": "/ساعة",
  "/d": "/يوم",
  "per hour": "لكل ساعة",
  "per day": "لكل يوم",
  "Audio and requests, {per}": "الصوت والطلبات، {per}",
  "avg {v}": "المتوسط {v}",
  hours: "ساعة",
  days: "يوم",
  Requests: "الطلبات",
  Model: "النموذج",
  "Share of audio": "حصته من الصوت",
  "Peak {label}: {d} of audio across {n} requests.": "الذروة {label}: {d} من الصوت في {n} طلب.",
  "at {a}": "عند {a}",
  "between {a} and {b}": "بين {a} و{b}",
  ", {pct} of everything.": "، أي {pct} من المجموع.",
  "carried {pct} of requests": "حمل {pct} من الطلبات",
  ";": "؛",
  "the remaining {pct}": "والباقي {pct}",
  ".": ".",
  "{idle} of {n} {unit}": "{idle} من {n} {unit}",
  "had no activity.": "بلا أي نشاط.",
  Archive: "الأرشيف",
  "The last 500 results, kept on this machine only, ten per page. Recordings are kept for the most recent 100, so older entries keep their text but lose their audio.":
    "آخر 500 نتيجة، محفوظة على هذا الجهاز فقط، عشر في كل صفحة. التسجيلات تُحفظ لأحدث 100 فقط، فتبقى للإدخالات الأقدم نصوصها دون صوتها.",
  "Clear history": "امسح السجل",
  Usage: "الاستخدام",
  "{d} of audio · {n} requests": "{d} من الصوت · الطلبات: {n}",
  Charts: "الرسوم",
  Analysis: "التحليل",
  Day: "يوم",
  Week: "أسبوع",
  Month: "شهر",
  "3 Months": "3 أشهر",
  "{n} req": "{n} طلب",
  "Nothing here yet": "لا شيء هنا بعد",
  "Press a line's hotkey, say something, and every result is kept here with what it cost and which models produced it.":
    "اضغط اختصار أي خط وقل شيئًا، وستُحفظ كل نتيجة هنا مع تكلفتها والنماذج التي أنتجتها.",
  "Show the finished text": "اعرض النص الجاهز",
  "Show the raw transcript": "اعرض النص المفرَّغ الخام",
  "Copy this result": "انسخ هذه النتيجة",
  "Run this entry through the current providers again, starting from the kept audio":
    "أعد معالجة هذا الإدخال بالمزوّدين الحاليين، بدءًا من الصوت المحفوظ",
  "The recording is gone - re-run refinement over the saved transcript":
    "التسجيل لم يعد موجودًا - أعد التنقيح على النص المفرَّغ المحفوظ",
  "Delete this entry": "احذف هذا الإدخال",
  "Recorded from {mic}": "سُجّل من {mic}",
  "Regenerating…": "جارٍ إعادة التوليد…",
  "Show less": "اعرض أقل",
  "Show the whole thing": "اعرض النص كاملًا",
  Newer: "الأحدث",
  Older: "الأقدم",
  "Page {page} of {count} · {n} entries": "الصفحة {page} من {count} · الإدخالات: {n}",
  "Clear all history?": "مسح السجل كاملًا؟",
  "All {n} entries and their recordings will be deleted permanently, along with the usage chart's data for those days. This cannot be undone.":
    "ستُحذف كل الإدخالات ({n}) وتسجيلاتها نهائيًا، ومعها بيانات رسم الاستخدام لتلك الأيام. لا يمكن التراجع عن ذلك.",
  "Delete everything": "احذف كل شيء",

  // ---------------------------------------------------------- the pill
  "Transcribing…": "يفرّغ…",
  "Refining…": "ينقّح…",

  // -------------------------------------------------------------- settings
  Configuration: "الضبط",
  "Changes are a draft until you save them. API keys never touch the settings file - they go to the Windows Credential Manager.":
    "التغييرات مسودة حتى تحفظها. مفاتيح API لا تُكتب أبدًا في ملف الإعدادات - بل تُحفظ في مدير بيانات الاعتماد في Windows.",
  Vocabulary: "المفردات",
  Engine: "المحرّك",
  Transcription: "التفريغ",
  Refinement: "التنقيح",
  "API keys": "مفاتيح API",
  Application: "التطبيق",
  "Audio & input": "الصوت والإدخال",
  "Recording pill": "مؤشر التسجيل",
  Appearance: "المظهر",
  About: "حول",
  Lines: "الخطوط",
  "Needs attention": "يحتاج إلى انتباه",

  // field helpers
  "model name": "اسم النموذج",
  "Save your changes first - this reads the saved key and endpoint":
    "احفظ تغييراتك أولًا - هذا يقرأ المفتاح والخادم المحفوظين",
  "Ask the provider which models this key can use": "اسأل المزوّد عن النماذج المتاحة لهذا المفتاح",
  "Load list": "حمّل القائمة",
  "{n} models available to this key. Click the field to pick one.":
    "النماذج المتاحة لهذا المفتاح: {n}. انقر الحقل لتختار واحدًا.",
  Working: "يعمل",
  "Not working": "لا يعمل",
  "Save your changes first": "احفظ تغييراتك أولًا",
  "Testing…": "جارٍ الاختبار…",
  "Test this stage": "اختبر هذه المرحلة",
  "Save your changes first - the test runs on what is stored.":
    "احفظ تغييراتك أولًا - الاختبار يعمل على الإعدادات المحفوظة.",
  "Press a key…": "اضغط مفتاحًا…",
  "Press the combination you want · Esc to cancel": "اضغط التركيبة التي تريدها · Esc للإلغاء",
  "Your saved key “{key}” could not be bound, so this was reset.":
    "تعذّر ربط مفتاحك المحفوظ «{key}»، فأُعيد ضبطه.",
  "Not bound.": "غير مربوط.",
  "Click, then press the keys · works in every app": "انقر ثم اضغط المفاتيح · يعمل في كل التطبيقات",
  "v{v} is the latest": "v{v} هو الأحدث",
  "couldn't reach GitHub - check your connection": "تعذّر الوصول إلى GitHub - تحقّق من اتصالك",

  // validation
  "Transcription needs a model name.": "التفريغ يحتاج إلى اسم نموذج.",
  "Transcription needs an endpoint base URL.": "التفريغ يحتاج إلى عنوان الخادم الأساسي.",
  "Refinement needs a model name.": "التنقيح يحتاج إلى اسم نموذج.",
  "Refinement needs an endpoint base URL.": "التنقيح يحتاج إلى عنوان الخادم الأساسي.",
  "Line {n} needs a name.": "الخط {n} يحتاج إلى اسم.",
  'Line "{name}" overrides transcription but names no model.':
    "الخط «{name}» يستخدم تفريغًا خاصًا به لكن دون اسم نموذج.",
  'Line "{name}" overrides refinement but names no model.':
    "الخط «{name}» يستخدم تنقيحًا خاصًا به لكن دون اسم نموذج.",

  // lines
  "One hotkey, one button, one way of processing what you say. A line decides how the speech is handled and where the finished text goes; anything it leaves alone falls through to the shared settings.":
    "اختصار واحد، وزر واحد، وطريقة واحدة لمعالجة ما تقول. الخط يحدد كيف يُعالَج الكلام وإلى أين يذهب النص الجاهز؛ وما لا يحدده يؤخذ من الإعدادات المشتركة.",
  "Move up": "انقل للأعلى",
  "Move down": "انقل للأسفل",
  "Line {n}": "الخط {n}",
  "own model": "نموذج خاص",
  "not bound": "غير مربوط",
  Remove: "أزل",
  "Remove this line": "أزل هذا الخط",
  Name: "الاسم",
  "What the button and the recording pill call it.": "الاسم الذي يظهر على الزر وعلى مؤشر التسجيل.",
  Hotkey: "الاختصار",
  "Press it anywhere to start, again to finish.": "اضغطه في أي مكان للبدء، ومرة ثانية للإنهاء.",
  Processing: "المعالجة",
  "How the transcript is turned into the finished text - and which icon this line shows on the recording pill.":
    "كيف يتحول النص المفرَّغ إلى نص جاهز - وأي أيقونة يُظهرها هذا الخط على مؤشر التسجيل.",
  "Your own instructions are set below, so the mode is not used.":
    "تعليماتك الخاصة مكتوبة في الأسفل، لذلك لا يُستخدم هذا النمط.",
  Destination: "الوجهة",
  "Paste it": "الصقه",
  "straight into whatever field has focus": "مباشرة في الحقل الذي تكتب فيه",
  "Show it here": "اعرضه هنا",
  "opens nutq with the text, nothing is pasted": "يفتح nutq مع النص، دون لصق أي شيء",
  "File a note": "احفظه كملاحظة",
  "lands on the Notes page instead": "يذهب إلى صفحة الملاحظات بدلًا من ذلك",
  "Custom instructions": "تعليمات خاصة",
  "Filled in, these replace the processing mode entirely - your own filter, your own format. Left empty, the mode above decides.":
    "إذا كتبتها، تحل محل نمط المعالجة كليًا - مرشّحك أنت، وشكلك أنت. وإن تركتها فارغة، يقرر النمط أعلاه.",
  "e.g. Turn anything I say into a short polite email reply":
    "مثلًا: حوّل كل ما أقوله إلى رد بريد إلكتروني قصير ومهذب",
  "Skip refinement": "تخطَّ التنقيح",
  "Paste the raw transcript and skip the second API call, however this line is otherwise set up.":
    "الصق النص المفرَّغ الخام وتخطَّ طلب API الثاني، مهما كانت بقية إعدادات هذا الخط.",
  "Own transcription model": "نموذج تفريغ خاص",
  "Off: this line uses the shared Transcription settings.": "عند الإيقاف: يستخدم هذا الخط إعدادات التفريغ المشتركة.",
  Provider: "المزوّد",
  "Own refinement model": "نموذج تنقيح خاص",
  "Off: this line uses the shared Refinement settings.": "عند الإيقاف: يستخدم هذا الخط إعدادات التنقيح المشتركة.",
  "Add a line": "أضف خطًا",
  "{n} lines · they appear on the Home page in this order": "الخطوط: {n} · تظهر في الصفحة الرئيسية بهذا الترتيب",

  // stage one
  "Stage 1: your voice to a raw transcript. Every line uses this unless it carries its own model.":
    "المرحلة 1: من صوتك إلى نص مفرَّغ خام. كل الخطوط تستخدمها ما لم يكن للخط نموذجه الخاص.",
  "Endpoint base URL": "عنوان الخادم الأساسي",
  "Include the version segment, no trailing slash. Sends to":
    "ضمّن جزء الإصدار، دون شرطة مائلة في النهاية. يُرسل إلى",
  "Type it, or load the list to see exactly what this key can reach. Providers retire model names without warning, so the loaded list is the only reliable answer.":
    "اكتبه، أو حمّل القائمة لترى بالضبط ما يصل إليه هذا المفتاح. المزوّدون يوقفون أسماء النماذج دون إنذار، فالقائمة المحمّلة هي الجواب الوحيد الموثوق.",
  "Backup provider": "مزوّد احتياطي",
  "If the main provider fails, this one retries the same audio with its own key. When both fail, the recording is parked on the Home page for a manual retry.":
    "إذا فشل المزوّد الأساسي، يعيد هذا المحاولة على الصوت نفسه بمفتاحه الخاص. وإذا فشل الاثنان، يُركن التسجيل في الصفحة الرئيسية لإعادة المحاولة يدويًا.",
  "Backup model": "النموذج الاحتياطي",
  "Sends 0.3 seconds of silence through the real code path — same URL, key, and model as a dictation — and reports exactly what came back.":
    "يرسل 0.3 ثانية من الصمت عبر المسار الحقيقي — نفس العنوان والمفتاح والنموذج كأي إملاء — ويخبرك بالضبط بما عاد.",

  // stage two
  "Stage 2: the raw transcript to the finished text - cleaned up, summarised, or turned into a spec, depending on the line.":
    "المرحلة 2: من النص المفرَّغ إلى النص الجاهز - منقّحًا أو ملخّصًا أو محوَّلًا إلى مواصفات، حسب الخط.",
  "Second stage": "المرحلة الثانية",
  "Transcript only is faster and skips the second API call entirely.":
    "«النص المفرَّغ فقط» أسرع ويتخطى طلب API الثاني تمامًا.",
  "Transcript only": "النص المفرَّغ فقط",
  "Refine it": "نقّحه",
  "Anthropic-compatible base URL": "عنوان أساسي متوافق مع Anthropic",
  "Leave empty for the official api.anthropic.com. Sends to":
    "اتركه فارغًا لاستخدام api.anthropic.com الرسمي. يُرسل إلى",
  "Known bases:": "عناوين معروفة:",
  "empty = https://api.anthropic.com": "فارغ = https://api.anthropic.com",
  "Sends to": "يُرسل إلى",
  "Type it, or load the list from the provider. Nothing here validates the name against a fixed list, so a model released today works today.":
    "اكتبه، أو حمّل القائمة من المزوّد. لا شيء هنا يقيّد الاسم بقائمة ثابتة، فالنموذج الذي يصدر اليوم يعمل اليوم.",
  "If the main provider fails, this one retries the same text with its own key. When both fail, the job is parked on the Home page for a manual retry.":
    "إذا فشل المزوّد الأساسي، يعيد هذا المحاولة على النص نفسه بمفتاحه الخاص. وإذا فشل الاثنان، تُركن المهمة في الصفحة الرئيسية لإعادة المحاولة يدويًا.",
  "Sends a one-word prompt through the real code path and reports exactly what came back.":
    "يرسل طلبًا من كلمة واحدة عبر المسار الحقيقي ويخبرك بالضبط بما عاد.",

  // keys
  "Keys your setup needs": "المفاتيح التي يحتاجها إعدادك",
  "Stored in the Windows Credential Manager, never in the settings file and never in this app's folder.":
    "تُحفظ في مدير بيانات الاعتماد في Windows، لا في ملف الإعدادات ولا في مجلد التطبيق.",
  "Not used right now": "غير مستخدمة حاليًا",
  "Nothing in your current configuration reads these. A key left here stays saved and costs nothing.":
    "لا شيء في إعدادك الحالي يقرأ هذه المفاتيح. المفتاح المتروك هنا يبقى محفوظًا ولا يكلّف شيئًا.",
  "Transcription endpoint": "خادم التفريغ",
  "your OpenAI-compatible transcription service": "خدمة التفريغ المتوافقة مع OpenAI لديك",
  "key for the endpoint below": "مفتاح الخادم المحدد أدناه",
  "Refinement endpoint": "خادم التنقيح",
  "your OpenAI-compatible chat service": "خدمة المحادثة المتوافقة مع OpenAI لديك",
  "forgotten on save": "يُحذف عند الحفظ",
  saved: "محفوظ",
  needed: "مطلوب",
  empty: "فارغ",
  "From {where}": "من {where}",
  "•••••••• (leave blank to keep)": "•••••••• (اتركه فارغًا للإبقاء عليه)",
  "Keep this key after all": "أبقِ هذا المفتاح",
  Undo: "تراجع",
  "Forget this key": "احذف هذا المفتاح",

  // capture
  "What nutq listens to, and what it keeps afterwards.": "ما يستمع إليه nutq، وما يحتفظ به بعد ذلك.",
  Microphone: "الميكروفون",
  "Default follows whatever Windows is set to. Pick a device to pin it.":
    "«الافتراضي» يتبع إعداد Windows. اختر جهازًا لتثبيته.",
  Default: "الافتراضي",
  "Language hint": "تلميح اللغة",
  "Passed to both stages. Naming the dialect matters far more than naming the language.":
    "يُمرَّر إلى المرحلتين. ذكر اللهجة أهم بكثير من ذكر اللغة.",
  "Keep recordings": "احتفظ بالتسجيلات",
  "Saves each recording next to its History entry so it can be played back - the only way to settle what was actually said when a transcript reads oddly. The newest 100 are kept. Off means nothing but text is ever written to disk.":
    "يحفظ كل تسجيل بجانب إدخاله في السجل لتعيد سماعه - الطريقة الوحيدة لمعرفة ما قيل فعلًا حين يبدو النص غريبًا. تُحفظ أحدث 100 تسجيل. عند الإيقاف لا يُكتب على القرص إلا النص.",
  "Hotkeys belong to the lines that use them - set them under":
    "الاختصارات تتبع الخطوط التي تستخدمها - اضبطها من",
  ". Every binding works in every app.": ". كل اختصار يعمل في كل التطبيقات.",
  "was reset": "أُعيد ضبطه",
  active: "مفعّل",

  // pill
  "The little indicator above the taskbar while the microphone is live. The preview runs on a simulated voice and walks through your own lines, so what you see is what the real pill does.":
    "المؤشر الصغير فوق شريط المهام أثناء عمل الميكروفون. المعاينة تعمل بصوت محاكى وتمرّ على خطوطك أنت، فما تراه هو ما يفعله المؤشر الحقيقي.",
  "Head of the pill": "رأس المؤشر",
  "The icon is the point: it says a note is being taken, or an idea is being turned into a spec, without writing the line's name across the screen.":
    "الأيقونة هي الفكرة: تخبرك أن ملاحظة تُدوَّن أو أن فكرة تتحول إلى مواصفات، دون كتابة اسم الخط على الشاشة.",
  "The line's icon": "أيقونة الخط",
  "A mic, a note, a bulb - what this line is about to make": "ميكروفون، ملاحظة، مصباح - ما سيصنعه هذا الخط",
  "Red dot": "نقطة حمراء",
  "The classic recording bead": "مؤشر التسجيل الكلاسيكي",
  Nothing: "لا شيء",
  "Wave and timer only": "الموجة والمؤقت فقط",
  "Write the line's name too": "اكتب اسم الخط أيضًا",
  "Off, the icon carries it and the pill stays short. On, the name is spelled out before the timer.":
    "عند الإيقاف تكفي الأيقونة ويبقى المؤشر قصيرًا. عند التشغيل يُكتب الاسم قبل المؤقت.",
  "Wave shape": "شكل الموجة",
  "What runs inside the pill while you speak.": "ما يتحرك داخل المؤشر وأنت تتكلم.",
  Bars: "أعمدة",
  "The classic dancing columns": "الأعمدة الراقصة الكلاسيكية",
  "Breathing band": "شريط يتنفس",
  "A soft band that swells with your voice": "شريط ناعم يتمدد مع صوتك",
  Syllables: "مقاطع",
  "One block per spoken syllable, gaps for pauses": "كتلة لكل مقطع منطوق، وفراغ لكل وقفة",
  "Level meter": "مقياس المستوى",
  "A gradient bar with a peak-hold marker": "شريط متدرّج مع علامة للذروة",
  Pulse: "نبض",
  "Rings around the dot, no wave at all": "حلقات حول النقطة، بلا موجة",
  Theme: "السمة",
  "One pick sets the glow, the wave and the background together, so the colours always match. Each swatch is the pill itself.":
    "اختيار واحد يضبط التوهج والموجة والخلفية معًا، فتتناسق الألوان دائمًا. كل عيّنة هي المؤشر نفسه.",
  Night: "ليلي",
  "Teal Night": "ليل فيروزي",
  Emerald: "زمرد",
  Matrix: "ماتريكس",
  Lime: "ليموني",
  Cyan: "سماوي",
  Frost: "صقيع",
  Ocean: "محيط",
  Indigo: "نيلي",
  Violet: "بنفسجي",
  Magenta: "أرجواني",
  Rose: "وردي",
  Crimson: "قرمزي",
  Ember: "جمر",
  Amber: "كهرماني",
  Gold: "ذهبي",
  Desert: "صحراء",
  Steel: "فولاذ",
  Carbon: "كربون",
  "Pure Day": "نهار صافٍ",
  "Day Mint": "نهار نعناعي",
  "Day Sky": "نهار سماوي",
  "Day Ocean": "نهار بحري",
  "Day Lilac": "نهار ليلكي",
  "Day Blossom": "نهار زهري",
  "Day Coral": "نهار مرجاني",
  "Day Sun": "نهار مشمس",
  "Day Sand": "نهار رملي",
  "Day Slate": "نهار رمادي",
  Paper: "ورق",
  "Glow — inner": "التوهج — داخلي",
  "Light on the pill's own edges, brightening with your voice.": "ضوء على حواف المؤشر نفسه، يشتد مع صوتك.",
  "Glow — outer": "التوهج — خارجي",
  "Light cast around the pill onto the screen behind it.": "ضوء ينتشر حول المؤشر على الشاشة خلفه.",

  // appearance
  "How this window paints itself. The recording pill has its own themes, under Recording pill.":
    "كيف تبدو هذه النافذة. لمؤشر التسجيل سماته الخاصة، في قسم «مؤشر التسجيل».",
  "Match Windows": "مثل Windows",
  "Follows the system light/dark setting": "يتبع وضع النظام الفاتح/الداكن",
  Light: "فاتح",
  "Always the light palette": "الألوان الفاتحة دائمًا",
  Dark: "داكن",
  "Always the dark palette": "الألوان الداكنة دائمًا",
  Language: "اللغة",
  "The app's own words. What you dictate is untouched - that is the Language hint, under Audio & input.":
    "لغة كلمات التطبيق نفسه. ما تمليه لا يتأثر - ذلك يحدده «تلميح اللغة» في قسم «الصوت والإدخال».",
  "Follows the Windows display language": "يتبع لغة عرض Windows",
  "Left to right": "من اليسار إلى اليمين",
  "The theme and the language apply the moment you pick them, so you can see them before saving. Discard puts them back.":
    "السمة واللغة تُطبَّقان لحظة اختيارهما، لترى النتيجة قبل الحفظ. «تجاهل» يعيدهما كما كانتا.",

  // about
  "What this install is, and whether anything newer is out. The sidebar says the version too; this page is where the details live.":
    "ما هذا الإصدار المثبّت، وهل صدر ما هو أحدث. الشريط الجانبي يذكر الإصدار أيضًا؛ وهنا التفاصيل.",
  Version: "الإصدار",
  "nutq · signed builds ship from github.com/fadi47at/nutq/releases":
    "nutq · الإصدارات الموقّعة تُنشر من github.com/fadi47at/nutq/releases",
  "Checking…": "جارٍ التحقق…",
  "Check for updates": "تحقّق من التحديثات",
  "v{new} is out — you have v{v}.": "صدر v{new} — لديك v{v}.",
  "A check also runs on its own when the app opens and every ten minutes after that; when a release is found, Home shows the offer without you asking. The sidebar's version line is the quickest answer to \"did the last install take?\"":
    "يجري التحقق تلقائيًا أيضًا عند فتح التطبيق وكل عشر دقائق بعد ذلك؛ وعند العثور على إصدار، تعرضه الصفحة الرئيسية دون أن تطلب. سطر الإصدار في الشريط الجانبي هو أسرع جواب عن «هل نجح التثبيت الأخير؟»",

  // vocabulary
  Corrections: "التصحيحات",
  "Terms the transcriber mishears. Left is what comes out wrong, right is what you actually said.":
    "كلمات يخطئ المُفرِّغ في سماعها. الأول ما يخرج خطأً، والثاني ما قلته فعلًا.",
  "heard as": "سُمعت هكذا",
  "should be": "والصحيح",
  "Nothing yet. Add the words this app keeps getting wrong.": "لا شيء بعد. أضف الكلمات التي يخطئ فيها التطبيق دائمًا.",
  "Add a correction": "أضف تصحيحًا",
  Snippets: "المقتطفات",
  "Say the trigger out loud and it expands to the text.": "قل الكلمة المفتاحية بصوت عالٍ فتتحول إلى النص كاملًا.",
  "when I say": "عندما أقول",
  "write this": "اكتب هذا",
  "Nothing yet. A snippet turns one spoken word into a whole phrase.":
    "لا شيء بعد. المقتطف يحوّل كلمة منطوقة واحدة إلى عبارة كاملة.",
  "Add a snippet": "أضف مقتطفًا",

  // save bar
  "Unsaved changes": "تغييرات غير محفوظة",
  "Ctrl+S saves": "Ctrl+S للحفظ",
  Saved: "تم الحفظ",
  "Everything on this page is saved.": "كل ما في هذه الصفحة محفوظ.",
  "Save changes": "احفظ التغييرات",
};
