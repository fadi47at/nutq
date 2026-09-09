# بناء نسخة macOS

المشروع جاهز للماك على مستوى الكود (التقاط الصوت عبر cpal/CoreAudio، الحافظة عبر
arboard، حفظ المفاتيح في Keychain عبر keyring، واللصق التلقائي عبر CGEvent يرسل
Cmd+V). لكن **بناء تطبيق الماك لا يتم إلا على macOS**: أدوات Apple (Xcode +
الموقّع + صانع الـ DMG) لا تعمل على ويندوز ولا يوجد cross-compile مدعوم لـ Tauri
نحو الماك.

## الطريقة الأولى: GitHub Actions (الأفضل — مجانية وقانونية)

مستودع المشروع يحتوي `.github/workflows/build-macos.yml` جاهزًا:

1. ارفع المشروع إلى مستودع على GitHub (عام public — الـ runners مجانية له).
2. افتح تبويب **Actions** → **Build macOS app** → **Run workflow**.
3. بعد انتهاء البناء نزّل الملف من **Artifacts** — تحصل على `nutq.app` و `.dmg`.

Apple ترخّص بناء الماك على سحابة GitHub رسميًا، فلا حاجة لأي جهاز ماك لديك.

## الطريقة الثانية: جهاز Mac حقيقي

على أي ماك (مستعار/مشتري/مستعمل):

```bash
# Xcode Command Line Tools
xcode-select --install
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# ثم داخل مجلد المشروع
npm ci
npm run tauri build -- --bundles app,dmg
```

الناتج في `nutq/src-tauri/target/release/bundle/`.

## أذونات macOS المطلوبة عند أول تشغيل

- **Microphone**: إملاء صوتي — يطلبه النظام تلقائيًا عند أول تسجيل.
- **Accessibility**: ضروري للّصق التلقائي في التطبيقات الأخرى
  (System Settings → Privacy & Security → Accessibility → أضف nutq).
- **Input Monitoring / Hotkeys**: اختصار التسجيل العام يعمل عبر
  RegisterEventHotKey ولا يحتاج إذنًا إضافيًا.

## ملاحظات توزيع

- التطبيق المبني بلا توقيع يفتح محليًا بزر يمين → Open (تجاوز Gatekeeper)،
  لكن لتوزيعه لآخرين تحتاج Apple Developer حساب (99$/سنة) مع codesign
  و notarization.
- البنية الافتراضية في الـ workflow هي Apple Silicon (M1/M2/M3). لأجهزة Intel
  القديمة غيّر runner إلى `macos-13` في ملف الـ workflow.

## لماذا لا يُنصح بـ macOS على VirtualBox/VMware داخل ويندوز؟

- مخالف لترخيص Apple (macOS يُشغَّل على عتاد Apple فقط).
- على أجهزة AMD (مثل هذا الجهاز) يتطلب ترقيع kernel بنمط Hackintosh — هش ومتعب.
- VirtualBox بلا تسريع رسومي: واجهة Xcode عصيّة والبناء بطيء جدًا.
- GitHub Actions يعطيك نفس النتيجة مجانًا وبنظام ملفات شرعي — هو الحل العملي.
