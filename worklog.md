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
