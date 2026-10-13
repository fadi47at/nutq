//! The Arabic for every string Rust passes through `tr`/`trf` (see
//! `i18n.rs`), keyed by its English. The terms are the interface's own:
//! line = خط, hotkey = اختصار, transcription = التفريغ, refinement =
//! التنقيح, provider = المزوّد, endpoint = خادم. `{placeholders}` must
//! survive; the tests in `i18n.rs` check that, and that nothing is missing.

pub const AR: &[(&str, &str)] = &[
    (
        "nothing was recorded",
        "لم يُسجَّل شيء",
    ),
    (
        "no default microphone",
        "لا يوجد ميكروفون افتراضي",
    ),
    (
        "The microphone is being held by another app right now - or a Bluetooth headset just switched modes. Close the other app using the mic, or wait a couple of seconds and press the hotkey again.",
        "الميكروفون محجوز الآن لتطبيق آخر - أو أن سماعة بلوتوث بدّلت وضعها للتو. أغلق التطبيق الآخر الذي يستخدم الميكروفون، أو انتظر ثانيتين واضغط الاختصار من جديد.",
    ),
    (
        "The microphone disappeared mid-use - unplugged, disabled, or switched away. Check that it is still selected in Settings.",
        "اختفى الميكروفون أثناء الاستخدام - فُصل أو عُطّل أو بُدّل. تأكد أنه ما زال مختارًا في الإعدادات.",
    ),
    (
        "The microphone refuses this audio format. Try picking a different one in Settings.",
        "الميكروفون يرفض صيغة الصوت هذه. جرّب اختيار ميكروفون آخر من الإعدادات.",
    ),
    (
        "The Windows audio service is not running. Start it (services.msc, \"Windows Audio\") and try again.",
        "خدمة الصوت في Windows متوقفة. شغّلها (services.msc، ثم \"Windows Audio\") وحاول مرة أخرى.",
    ),
    (
        "microphone not found: {name}",
        "الميكروفون غير موجود: {name}",
    ),
    (
        "Microphone error: {raw}\n\n{hint}",
        "خطأ في الميكروفون: {raw}\n\n{hint}",
    ),
    (
        "could not create the mp3 encoder",
        "تعذّر تجهيز محوّل mp3",
    ),
    (
        "the audio for this entry is gone: {e}",
        "صوت هذا الإدخال لم يعد موجودًا: {e}",
    ),
    (
        "ElevenLabs does not publish a model list here. Use scribe_v1.",
        "لا توفّر ElevenLabs قائمة نماذج هنا. استخدم scribe_v1.",
    ),
    (
        "could not read the Gemini model list: {e}",
        "تعذّرت قراءة قائمة نماذج Gemini: {e}",
    ),
    (
        "could not read the Claude model list: {e}",
        "تعذّرت قراءة قائمة نماذج Claude: {e}",
    ),
    (
        "{url} did not return an OpenAI-style model list ({e}). Some endpoints do not expose one - type the model name in by hand instead.",
        "{url} لم يُرجع قائمة نماذج بصيغة OpenAI ({e}). بعض الخوادم لا توفّرها - اكتب اسم النموذج بيدك بدلًا من ذلك.",
    ),
    (
        "{who} returned an empty model list for this key.",
        "{who} أرجع قائمة نماذج فارغة لهذا المفتاح.",
    ),
    (
        "No key is set.",
        "لا يوجد اختصار محدد.",
    ),
    (
        " \"+\" is the separator between a modifier and a key, so it cannot name a key by itself. The plus on the numeric keypad is \"NumpadAdd\"; click the field and press the key to have it filled in correctly.",
        " علامة \"+\" تفصل بين مفتاح التعديل والمفتاح، فلا يمكن أن تكون مفتاحًا بذاتها. علامة الزائد في لوحة الأرقام اسمها \"NumpadAdd\"؛ انقر الحقل واضغط المفتاح ليُكتب صحيحًا.",
    ),
    (
        " Click the field and press the key you want, rather than typing its name.",
        " انقر الحقل واضغط المفتاح الذي تريده، بدل كتابة اسمه.",
    ),
    (
        "Windows refused this key - another app is probably already using it globally. Pick a different one. ({e})",
        "رفض Windows هذا الاختصار - على الأرجح يستخدمه تطبيق آخر. اختر اختصارًا غيره. ({e})",
    ),
    (
        "The shortcut {key} is registered now. Another app was holding it when nutq started.",
        "الاختصار {key} صار مفعّلًا الآن. كان تطبيق آخر يحجزه عند تشغيل nutq.",
    ),
    (
        "could not lock clipboard memory",
        "تعذّر حجز ذاكرة الحافظة",
    ),
    (
        "copying a recording as a file is implemented for Windows so far",
        "نسخ التسجيل كملف متاح على Windows فقط حتى الآن",
    ),
    (
        "could not send the paste keystroke - the text is on your clipboard, press Ctrl+V",
        "تعذّر إرسال أمر اللصق - النص في الحافظة، اضغط Ctrl+V",
    ),
    (
        "could not create the event source",
        "تعذّر تجهيز مصدر الأحداث",
    ),
    (
        "could not create the paste event",
        "تعذّر تجهيز أمر اللصق",
    ),
    (
        "automatic pasting is only implemented on Windows and macOS",
        "اللصق التلقائي متاح على Windows وmacOS فقط",
    ),
    (
        "could not open the clipboard: {e}",
        "تعذّر فتح الحافظة: {e}",
    ),
    (
        "could not write to the clipboard: {e}",
        "تعذّرت الكتابة في الحافظة: {e}",
    ),
    (
        "could not allocate clipboard memory: {e}",
        "تعذّر حجز ذاكرة للحافظة: {e}",
    ),
    (
        "could not place the file on the clipboard: {e}",
        "تعذّر وضع الملف في الحافظة: {e}",
    ),
    (
        "The recording indicator stopped drawing and was rebuilt - no restart needed. The details are in the overlay log.",
        "توقف مؤشر التسجيل عن الظهور فأُعيد بناؤه - لا حاجة لإعادة التشغيل. التفاصيل في سجل المؤشر (overlay.log).",
    ),
    (
        "Timed out asking the provider for its model list.",
        "انتهت المهلة أثناء طلب قائمة النماذج من المزوّد.",
    ),
    (
        "Nothing was heard, so nothing was sent. If you did speak, check that the right microphone is selected in Settings and that it is not muted.",
        "لم يُسمع شيء، فلم يُرسل شيء. إذا كنت تكلمت فعلًا، تأكد أن الميكروفون الصحيح مختار في الإعدادات وأنه غير مكتوم.",
    ),
    (
        "wait for the current dictation to finish first",
        "انتظر حتى ينتهي الإملاء الحالي أولًا",
    ),
    (
        "this job is no longer pending",
        "هذه المهمة لم تعد بانتظار إعادة المحاولة",
    ),
    (
        "this entry has no transcript to regenerate from",
        "هذا الإدخال ليس له نص مفرَّغ لإعادة التوليد منه",
    ),
    (
        "this entry no longer exists",
        "هذا الإدخال لم يعد موجودًا",
    ),
    (
        "nutq - press your hotkey to dictate",
        "nutq - اضغط اختصارك لتبدأ الإملاء",
    ),
    (
        "Open nutq",
        "افتح nutq",
    ),
    (
        "Quit",
        "خروج",
    ),
    (
        "could not rebuild the recording indicator: {e}",
        "تعذّرت إعادة بناء مؤشر التسجيل: {e}",
    ),
    (
        "Line {n} ({name}): {e}",
        "الخط {n} ({name}): {e}",
    ),
    (
        "The test timed out after {secs} seconds with no reply. The endpoint is unreachable, very slow, or being blocked before it can answer.",
        "انتهت مهلة الاختبار بعد {secs} ثانية دون رد. الخادم غير قابل للوصول، أو بطيء جدًا، أو محجوب قبل أن يجيب.",
    ),
    (
        "The idea threads' provider failed, trying the backup: {e}",
        "فشل مزوّد خيوط الأفكار، جارٍ تجربة الاحتياطي: {e}",
    ),
    (
        "primary: {primary} | backup: {backup}",
        "الأساسي: {primary} | الاحتياطي: {backup}",
    ),
    (
        "Transcription failed, trying the backup provider: {e}",
        "فشل التفريغ، جارٍ تجربة المزوّد الاحتياطي: {e}",
    ),
    (
        "Refinement failed, trying the backup provider: {e}",
        "فشل التنقيح، جارٍ تجربة المزوّد الاحتياطي: {e}",
    ),
    (
        "Could not file that thought in an idea thread: {e}",
        "تعذّر حفظ هذه الخاطرة في خيط أفكار: {e}",
    ),
    (
        "could not save the failed job for retry: {e}",
        "تعذّر حفظ المهمة الفاشلة لإعادة المحاولة: {e}",
    ),
    (
        "That recording was only {secs}s - too short to be speech, so it was discarded. Hold the hotkey session open a moment longer before ending it.",
        "كان التسجيل {secs} ث فقط - أقصر من أن يكون كلامًا، فتم تجاهله. أبقِ التسجيل مفتوحًا لحظة أطول قبل إنهائه.",
    ),
    (
        "Transcription failed on every provider. The recording was saved - retry it from the Pending list on the Home page. ({e})",
        "فشل التفريغ عند كل المزوّدين. حُفظ التسجيل - أعد المحاولة من قائمة «بانتظار إعادة المحاولة» في الصفحة الرئيسية. ({e})",
    ),
    (
        "Refinement failed on every provider - the raw transcript was used, and the job was saved to Pending for a retry. ({e})",
        "فشل التنقيح عند كل المزوّدين - استُخدم النص المفرَّغ الخام، وحُفظت المهمة لإعادة المحاولة لاحقًا. ({e})",
    ),
    (
        "still failing, the job stays pending: {e}",
        "ما زال يفشل، وتبقى المهمة بانتظار إعادة المحاولة: {e}",
    ),
    (
        "refinement failed again, kept pending: {e}",
        "فشل التنقيح مرة أخرى، وبقيت المهمة بانتظار إعادة المحاولة: {e}",
    ),
    (
        "regeneration failed, the entry is unchanged: {e}",
        "فشلت إعادة التوليد، والإدخال لم يتغير: {e}",
    ),
    (
        "{tooltip} - new version available",
        "{tooltip} - يتوفر إصدار جديد",
    ),
    (
        "Stage 1 (transcription)",
        "المرحلة 1 (التفريغ)",
    ),
    (
        "Stage 2 (refinement)",
        "المرحلة 2 (التنقيح)",
    ),
    (
        "\"Transcription endpoint\" key",
        "مفتاح «خادم التفريغ»",
    ),
    (
        "\"Claude\" (or \"Refinement endpoint\") key",
        "مفتاح «Claude» (أو «خادم التنقيح»)",
    ),
    (
        "the server did not respond in time. It may be slow, blocked, or unreachable from your network.",
        "لم يرد الخادم في الوقت المحدد. قد يكون بطيئًا أو محجوبًا أو غير قابل للوصول من شبكتك.",
    ),
    (
        "the connection could not be opened. Check the host name, and whether a firewall, VPN, or regional block is in the way.",
        "تعذّر فتح الاتصال. تحقق من اسم الخادم، ومن عدم وجود جدار حماية أو VPN أو حجب إقليمي يعترضه.",
    ),
    (
        "the request could not be built. The URL is probably malformed.",
        "تعذّر بناء الطلب. على الأرجح العنوان (URL) مكتوب بشكل خاطئ.",
    ),
    (
        "the request failed before a reply arrived.",
        "فشل الطلب قبل وصول أي رد.",
    ),
    (
        "the rate limit was hit. Wait a moment and try again.",
        "تم بلوغ حد الطلبات. انتظر لحظة وحاول مرة أخرى.",
    ),
    (
        "(the response body was empty)",
        "(الرد كان فارغًا)",
    ),
    (
        "could not start the HTTP client: {e}",
        "تعذّر تشغيل عميل الاتصال: {e}",
    ),
    (
        "{stage}: the endpoint returned an error.\n\nIt said: {msg}\n\nCalled: {url}",
        "{stage}: أرجع الخادم خطأً.\n\nقال: {msg}\n\nالعنوان المطلوب: {url}",
    ),
    (
        "{stage}: no endpoint base URL is set. Add one in Settings.",
        "{stage}: لا يوجد عنوان أساسي للخادم. أضفه من الإعدادات.",
    ),
    (
        "{stage}: \"{raw}\" does not look like a URL. It should be the API base, for example https://api.z.ai/api/paas/v4",
        "{stage}: «{raw}» لا يبدو عنوانًا صحيحًا. يجب أن يكون العنوان الأساسي للـ API، مثل https://api.z.ai/api/paas/v4",
    ),
    (
        "{stage} could not reach the endpoint - {cause}\n\nCalled: {url}\n\nNothing was sent, so this is not a key problem.",
        "{stage}: تعذّر الوصول إلى الخادم - {cause}\n\nالعنوان المطلوب: {url}\n\nلم يُرسل شيء، فالمشكلة ليست في المفتاح.",
    ),
    (
        "{stage}: that model does not exist on this provider, or your account cannot use it. Press \"Load list\" next to the model field to see what this key can actually reach.\n\nIt said: {detail}\n\nCalled: {url}",
        "{stage}: هذا النموذج غير موجود عند هذا المزوّد، أو أن حسابك لا يستطيع استخدامه. اضغط «حمّل القائمة» بجانب حقل النموذج لترى ما يصل إليه هذا المفتاح فعلًا.\n\nقال: {detail}\n\nالعنوان المطلوب: {url}",
    ),
    (
        "the endpoint rejected the request as malformed. Usually the model name is wrong or unsupported.\n\nIt said: {detail}",
        "رفض الخادم الطلب لأنه غير صالح. غالبًا اسم النموذج خاطئ أو غير مدعوم.\n\nقال: {detail}",
    ),
    (
        "the endpoint is reachable but refused the key. This is a credential problem, not a URL problem - fix the {field}.\n\nIt said: {detail}",
        "الخادم قابل للوصول لكنه رفض المفتاح. المشكلة في المفتاح لا في العنوان - صحّح {field}.\n\nقال: {detail}",
    ),
    (
        "the key was accepted but is not allowed to use this model or endpoint. Check the plan or permissions on the provider account.\n\nIt said: {detail}",
        "قُبل المفتاح لكنه غير مسموح له باستخدام هذا النموذج أو الخادم. راجع الخطة أو الصلاحيات في حساب المزوّد.\n\nقال: {detail}",
    ),
    (
        "nothing exists at that address. Either the base URL is wrong, or the model name does not exist on this provider.\n\nIt said: {detail}",
        "لا يوجد شيء على هذا العنوان. إما أن العنوان الأساسي خاطئ، أو أن اسم النموذج غير موجود عند هذا المزوّد.\n\nقال: {detail}",
    ),
    (
        "the endpoint could not process the request.\n\nIt said: {detail}",
        "تعذّر على الخادم معالجة الطلب.\n\nقال: {detail}",
    ),
    (
        "the account is out of credit or has no active billing.\n\nIt said: {detail}",
        "نفد رصيد الحساب أو لا يوجد اشتراك مدفوع فعّال.\n\nقال: {detail}",
    ),
    (
        "the provider is having trouble on their side ({status}). Nothing here is misconfigured - try again.\n\nIt said: {detail}",
        "المزوّد يواجه مشكلة من جهته ({status}). لا شيء خاطئ في إعداداتك - حاول مرة أخرى.\n\nقال: {detail}",
    ),
    (
        "it returned {status}.\n\nIt said: {detail}",
        "أرجع الرمز {status}.\n\nقال: {detail}",
    ),
    (
        "{stage}: {explanation}\n\nCalled: {url}",
        "{stage}: {explanation}\n\nالعنوان المطلوب: {url}",
    ),
    (
        "pending job not found",
        "المهمة المؤجلة غير موجودة",
    ),
    (
        "this job has no audio to retry",
        "هذه المهمة ليس لها صوت لإعادة المحاولة",
    ),
    (
        "could not read the parked audio: {e}",
        "تعذّرت قراءة الصوت المحفوظ: {e}",
    ),
    (
        "the refinement request was declined",
        "رُفض طلب التنقيح",
    ),
    (
        "could not parse the Claude response: {e}",
        "تعذّرت قراءة رد Claude: {e}",
    ),
    (
        "could not parse the Gemini response: {e}",
        "تعذّرت قراءة رد Gemini: {e}",
    ),
    (
        "{stage}: no model name is set. Add the one this endpoint expects in Settings.",
        "{stage}: لا يوجد اسم نموذج. أضف الاسم الذي يتوقعه هذا الخادم من الإعدادات.",
    ),
    (
        "{stage}: the reply was not the expected chat-completions shape ({e}). The URL may point at something that is not an OpenAI-compatible API.\n\nCalled: {url}",
        "{stage}: الرد لم يكن بصيغة chat-completions المتوقعة ({e}). ربما يشير العنوان إلى شيء ليس API متوافقًا مع OpenAI.\n\nالعنوان المطلوب: {url}",
    ),
    (
        "Claude answered as {model}.",
        "أجاب Claude بالنموذج {model}.",
    ),
    (
        "Gemini answered as {model}.",
        "أجاب Gemini بالنموذج {model}.",
    ),
    (
        "{base}/chat/completions answered as {model}.",
        "أجاب {base}/chat/completions بالنموذج {model}.",
    ),
    (
        "{stage}: the request succeeded but the reply had no text in it. The model may have returned only a refusal or an empty completion.\n\nCalled: {url}",
        "{stage}: نجح الطلب لكن الرد بلا نص. ربما أرجع النموذج رفضًا فقط أو ردًا فارغًا.\n\nالعنوان المطلوب: {url}",
    ),
    (
        "Transcription endpoint",
        "خادم التفريغ",
    ),
    (
        "Refinement endpoint",
        "خادم التنقيح",
    ),
    (
        "No API key is saved for \"{slot}\". Open Settings, put the key in that field, and press Save changes.",
        "لا يوجد مفتاح API محفوظ لـ «{slot}». افتح الإعدادات، وضع المفتاح في ذلك الحقل، واضغط «احفظ التغييرات».",
    ),
    (
        "The saved \"{slot}\" key is blank. Re-enter it in Settings.",
        "مفتاح «{slot}» المحفوظ فارغ. أدخله من جديد في الإعدادات.",
    ),
    (
        "Gemini returned no transcript",
        "لم يُرجع Gemini أي نص مفرَّغ",
    ),
    (
        "the recording was too long and the transcript was cut off",
        "التسجيل كان أطول من اللازم فانقطع النص المفرَّغ",
    ),
    (
        "no speech was detected in the recording. The request itself succeeded, so check that the right microphone is selected in Settings.",
        "لم يُكتشف كلام في التسجيل. الطلب نفسه نجح، فتأكد أن الميكروفون الصحيح مختار في الإعدادات.",
    ),
    (
        "could not parse the Gemini response: {e}\n\nCalled: {url}",
        "تعذّرت قراءة رد Gemini: {e}\n\nالعنوان المطلوب: {url}",
    ),
    (
        "Gemini blocked the audio ({reason})",
        "حجب Gemini الصوت ({reason})",
    ),
    (
        "could not parse the ElevenLabs response: {e}",
        "تعذّرت قراءة رد ElevenLabs: {e}",
    ),
    (
        "could not build the audio upload: {e}",
        "تعذّر تجهيز رفع الصوت: {e}",
    ),
    (
        "{model} accepted the audio.",
        "قبل {model} الصوت.",
    ),
    (
        "{model} accepted the audio and returned an empty transcript, which is correct for silence.",
        "قبل {model} الصوت وأرجع نصًا فارغًا، وهذا صحيح لأن التسجيل كان صمتًا.",
    ),
    (
        "that thread no longer exists",
        "هذا الخيط لم يعد موجودًا",
    ),
    (
        "the model's answer had no document in it, so the old one was kept",
        "رد النموذج لم يحوِ مستندًا، فبقي المستند القديم",
    ),
    (
        "Could not decide which idea that thought belongs to, so it started a new one: {e}",
        "تعذّر تحديد الفكرة التي تخصها هذه الخاطرة، فبدأت فكرة جديدة: {e}",
    ),
    (
        "The thought was saved, but its idea's document could not be updated: {e}",
        "حُفظت الخاطرة، لكن تعذّر تحديث مستند فكرتها: {e}",
    ),
];
