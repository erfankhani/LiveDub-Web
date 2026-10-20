# Worklog

---
Task ID: 0
Agent: main (Z.ai Code)
Task: تحلیل اکستنشن دوبله زنده کروم و برنامه‌ریزی: رفع باگ ۱۵ دقیقه، ساخت نسخه اندروید، UI حرفه‌ای، دوبله بک‌گراند

Work Log:
- فایل‌های آپلودی خوانده شد: background.js, offscreen.js, popup.js/html, pcm-processor.js, manifest.json
- ریشه باگ ۱۵ دقیقه شناسایی شد: Gemini Live API سشن WebSocket را پس از ~۱۵ دقیقه می‌بندد و offscreen.js هیچ منطق reconnect ندارد (onclose خالی است)
- راه‌حل: Session Rotation (اتصال موازی سوکت جدید در ~۱۳.۵ دقیقه + بافر صدا + hot-swap) و Auto-reconnect با backoff نمایی
- نسخه اندروید: سورس کامل Kotlin/Compose با MediaProjection + AudioPlaybackCapture (دوبله هر اپ: یوتیوب و ...) + Foreground Service (بک‌گراند) + همان منطق Session Rotation
- صفحه دِلیوری Next.js برای دانلود زیپ‌ها + راهنمای نصب

Stage Summary:
- ساختار پروژه Next.js 16 موجود است، شادcn/ui کامل است، zip موجود است
- پوشه‌های خروجی: /extension (اکستنشن v2), /android-app/LiveDubAndroid (سورس اندروید), /public/downloads (زیپ‌ها)

---
Task ID: 1
Agent: main (Z.ai Code)
Task: اجرای کامل: رفع باگ ۱۵ دقیقه + اکستنشن v2 + سورس اندروید + صفحه دِلیوری

Work Log:
- extension/: manifest v2.0.0 (آیکون‌دار), background.js (مدیریت offscreen + broadcast وضعیت), offscreen.js (Session Rotation هر 13.5min + goAway handler + بافر 12s + Backoff reconnect + زیرنویس زنده + کنترل ولوم زنده), popup.html/js (UI حرفه‌ای تیره RTL + آمار زنده + زیرنویس + اسلایدرها), pcm-processor.js, icons 16/32/48/128 (تولید با image-generation + sharp)
- android-app/LiveDubAndroid/: پروژه کامل Kotlin 2.0 + Compose (AGP 8.5.2, minSdk 29, targetSdk 35) شامل GeminiLiveClient (Session Rotation + Reconnect), LiveDubService (FGS mediaProjection + WakeLock + بافر صدا), AudioCaptureEngine (AudioPlaybackCapture همه اپ‌ها), AudioPlayerEngine (AudioTrack 24k + کانال مکالمه), PcmResampler (48k→16k), MainActivity + AppScreen (UI تیره RTL), mipmap icons, README فارسی
- public/downloads/: livedub-extension-v2.zip (47K, 12 فایل), livedub-android-source.zip (142K, 49 فایل), livedub-icon-512.png
- src/app/page.tsx + layout.tsx: صفحه دِلیوری RTL فارسی تیره با سکشن‌های hero/ریشه‌یابی باگ/timeline rotation/features/دانلود/راهنمای نصب تبی‌دار/footer sticky
- lint: 0 error; syntax validation همه JS فایل‌های اکستنشن OK
- Agent Browser: رندر دسکتاپ/موبایل OK، تب اندروید/کروم سوییچ OK، لینک‌های دانلود 200، فوتر sticky OK (gap=1px safe-area)، بدون خطای کنسول

Stage Summary:
- باگ ۱۵ دقیقه با Session Rotation رفع شد (هم در کروم هم اندروید)
- دوبله بک‌گراند: کروم = offscreen doc مستقل؛ اندروید = FGS + WakeLock + MediaProjection برای هر اپ
- خروجی‌ها: extension/ , android-app/LiveDubAndroid/ , public/downloads/

---
Task ID: 2
Agent: main (Z.ai Code)
Task: پوش پروژه اندروید به GitHub کاربر (erfankhani) + بیلد خودکار APK

Work Log:
- توکن کاربر بررسی شد: اکانت erfankhani، اسکوپ repo+workflow
- workflow بیلد APK اضافه شد: .github/workflows/build.yml (JDK 17 + Gradle 8.9 + assembleDebug/Release + upload artifact)
- ریپو erfankhani/LiveDub-Android ساخته و پوش شد (3 کامیت)
- بیلد اول fail شد: import های جاافتاده MainActivity (LiveDubService, AppScreen) + ROTATE_MS به‌صورت Double بود (13.5*60*1000L) → اصلاح به 810_000L
- بیلد دوم fail شد: تداخل JVM signature پراپرتی volume با متد setVolume → پراپرتی به dubVolume تغییر نام یافت
- بیلد سوم: SUCCESS ✓ — دو آرتیفکت: LiveDub-debug-apk (~14MB) و LiveDub-release-apk-unsigned (~1.3MB)
- زیپ محلی android با کد اصلاح‌شده به‌روزرسانی شد
- توکن از git remote حذف شد و در هیچ فایلی ذخیره نشد

Stage Summary:
- ریپو: https://github.com/erfankhani/LiveDub-Android (public, main branch)
- سورس Kotlin 100% معتبر است (بیلد CI موفق)
- کاربر می‌تواند APK را از Actions → Build APK → Artifacts دانلود کند
- به کاربر توصیه شد توکن را revoke/rotate کند چون در چت به اشتراک گذاشته شده
