# المساهمة في nutq

ملف العمل الكامل (الإصدارات، السرية، الأدلة) في `AGENTS.md` بجذر المستودع.
هذه الصفحة المجتزأة تكفي لبدء العمل بسرعة:

## البيئة

1. متطلبات: Node 22+، Rust (rustup)، VS C++ Build Tools — التفاصيل في
   `nutq/README.md`.
2. تحقق سريع قبل كل جلسة، من جذر المستودع:

   ```powershell
   # داخل nutq/
   npx tsc --noEmit
   # داخل nutq/src-tauri/
   cargo check
   cargo test
   ```

3. CI (`.github/workflows/ci-windows.yml`) يشغّل نفس الفحوصات على كل push —
   ما يمر محليًا لا يُرفَع.

## قواعد لا تُخترق

- لا مفاتيح/أسرار في المستودع أبدًا — المفاتيح تعيش في مخزن نظام التشغيل فقط.
- قبل كل commit: `git status` و`git diff` وتُقرأ التغييرات فعليًا.
- كل تغيير يراه المستخدم يقترن برفع نسخة في الملفات الثلاثة معًا
  (`package.json`، `tauri.conf.json`، `Cargo.toml`) ووسم `v<version>`.
- لا تكتب JSON/TOML بأدوات PowerShell القديمة (BOM يكسر Vite) — استخدم
  أدوات الملفات.
- `AGENTS.md` و`nutq/README.md` يبقيان صادقين في نفس commit الذي غيّر
  السلوك.

## بناء وإصدار

- تطوير: `npm run tauri dev` داخل `nutq/`.
- إصدار: طقوس كاملة في `AGENTS.md` — اختصارًا: رفع الثلاثة ملفات →
  commit → tag → `scripts\publish-release.ps1`.
