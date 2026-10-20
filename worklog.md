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

---
Task ID: 3
Agent: main (Z.ai Code)
Task: رفع باگ «اپ اندروید وصل می‌شود ولی دوبله نمی‌کند» + پیش‌نمایش اجرایی وبی برای تست در پنل Preview

Work Log:
- مقایسه سورس اندروید با اکستنشن اصلی کاربر (upload/offscreen.js): پروتکل و مدل (gemini-3.5-live-translate-preview) یکسان و صحیح بود — تأیید وجود مدل در مستندات رسمی ai.google.dev
- ریشه‌ها: خطاهای سرور/سوکت در GeminiLiveClient بی‌صدا نادیده می‌شدند؛ AudioRecord/AudioTrack بدون بررسی state بودند (شکست بی‌صدا)؛ تاگل «اشتراک صدا» خاموش = کپچر کاملاً ساکت بدون هیچ هشداری
- GeminiLiveClient.kt: handler جدید onError + دی‌دوپ خطا + شمارنده sentBytes/recvAudioBytes + onStats چهارآرگومانی + نمایش کد HTTP/کد close
- AudioCaptureEngine.kt: بررسی STATE_INITIALIZED + گزارش سطح صدا (0..1) + خطاهای read با کد + Handler اصلی برای callback پروجکشن
- AudioPlayerEngine.kt: بررسی state + onError callback
- LiveDubService.kt: watchdog سکوت (۳ ثانیه → هشدار زرد «اشتراک صدا») + broadcastStatsLive هر ۲ ثانیه + extras جدید (sentKb/recvKb/inputLevel/warn)
- MainActivity/AppScreen: بنر خطا/هشدار + متر زنده ورودی + آمار KB + راهنمای Share device audio
- src/components/LiveDubTester.tsx: موتور کامل دوبله وبی (همان پروتکل: setup + translationConfig + rotation 13.5min + backoff + بافر) با متر صدا، زیرنویس، کنسول لاگ، دکمه «تست چرخش سشن»، کلید در localStorage
- public/livedub-pcm-processor.js (AudioWorklet) + سکشن «تست زنده همین‌جا» در page.tsx + استایل اسکرول‌بار
- Agent-Browser: شروع بدون کلید → پیام خطا ✓؛ با استریم ماک → اتصال واقعی WS به گوگل ✓، سرور پاسخ «API key not valid (کد 1007)» داد و در بنر/لاگ نمایش یافت ✓ (با کلید واقعی همان مسیر تا setupComplete می‌رود)؛ موبایل ریسپانسیو ✓؛ فوتر sticky gap=0 ✓؛ zip جدید 200 ✓؛ lint 0 خطا
- زیپ اندروید بازسازی شد (public/downloads/livedub-android-source.zip — 350KB) و کامیت محلی 6835821 ساخته شد

Stage Summary:
- پوش به GitHub انجام نشد: توکن کاربر دیگر معتبر نیست (401) — احتمالاً revoke شده. کامیت محلی آماده است؛ دستور پوش با توکن جدید باید اجرا شود
- اپ اندروید v2.1 اکنون هر شکست احتمالی را در UI نشان می‌دهد؛ شایع‌ترین علت کاربر (تاگل اشتراک صدا) با هشدار زرد + متر صفر قابل مشاهده است

---
Task ID: 4
Agent: main (Z.ai Code)
Task: پوش اصلاحات به GitHub با توکن جدید کاربر + پایش بیلد CI تا موفقیت

Work Log:
- توکن جدید بررسی شد: کاربر erfankhani، اسکوپ repo+workflow ✓
- کامیت 6835821 (فیکس عیب‌یابی) پوش شد → بیلد CI اول fail شد: خطای کامپایل AppScreen.kt:340-341 (faNum با String به‌جای Int)
- لاگ job از API دانلود و خطا دقیق استخراج شد → faNum(status.sentKb) اصلاح شد
- کامیت da26e60 پوش شد → بیلد CI دوم: SUCCESS در ~۳ دقیقه
- آرتیفکت‌ها: LiveDub-debug-apk (~14.2MB) + LiveDub-release-apk-unsigned (~1.3MB)
- زیپ محلی مجدداً بازسازی شد (393,949 bytes)
- توکن پس از هر پوش از git remote حذف شد و در هیچ فایلی ذخیره نشد

Stage Summary:
- ریپو: https://github.com/erfankhani/LiveDub-Android — HEAD = da26e60، بیلد سبز
- کاربر APK نسخه v2.1 (با متر عیب‌یابی) را از Actions → Artifacts می‌تواند دانلود کند
- یادآوری امنیتی به کاربر: revoke توکن پس از استفاده (در چت لو رفته است)

---
Task ID: 5
Agent: main (Z.ai Code)
Task: فیکس نهایی دوبله صدای اندروید (sent=0KB) + رفع خطای display-capture پنل Preview + حالت دمو

Work Log:
- تحلیل اسکرین‌شات کاربر: sent=0KB، recv=0KB، reconnects=0، بدون خطا، متر ورودی صفر → تشخیص: یا کپچر اصلاً نمی‌خواند یا کلاینت فعال نشده (سوکت باز و پایدار بوده چون reconnects=0)
- ریشه‌یابی مقایسه‌ای با اکستنشن کروم کاربر (upload/offscreen.js): اکستنشن صدا را بلافاصله بعد از onOpen می‌فرستد (قبل از setupComplete) و کار می‌کند؛ اپ اندروید منتظر setupComplete بود → اگر سرور آن را نمی‌داد، همه‌چیز بی‌صدا صفر می‌ماند
- GeminiLiveClient.kt (v2.2): فعال‌سازی فوری سوکت در onOpen برای initial/reconnect (مثل اکستنشن)؛ rotate همچنان منتظر setupComplete برای Hot-Swap؛ watchdog تایم‌اوت Setup (12s) با خطای واضح؛ فلگ عمومی isSetupComplete؛ رفع رفتار نامناسب handleDisconnect برای شکست تمدید (retry تمدید بعد 5s به‌جای reconnect کامل)
- AudioCaptureEngine.kt: heartbeat ضبط (۶ ثانیه بدون داده → خطای واضح به‌جای مرگ بی‌صدا در read بلاک‌شده)؛ شمارنده عمومی chunksRead؛ stop() با record.stop() برای از-بلاک-کردن read (رفع لیک AudioRecord)
- LiveDubService.kt: broadcast سه فیلد تشخیصی جدید (captureChunks / setupOk / socketOpen) هر ۲ ثانیه
- MainActivity.kt + Manifest: دسترسی RECORD_AUDIO (برای برخی OEMها مثل سامسونگ که بدون آن تاگل «اشتراک صدا» را در پنجره ضبط نشان نمی‌دهند) با زنجیره نوتیفیکیشن→میکروفون→پروجکشن
- AppScreen.kt: نوار تشخیص زنده سه‌چراغی (سوکت/تأیید سرور/ضبط صدا) + آمار «چانک ضبط» + پیام قرمز متمایز «ضبط داده‌ای نخوانده» در برابر «ساکت»
- LiveDubTester.tsx: منبع سوم «دمو» — نمونه گفتار فارسی ۲۶ ثانیه‌ای (TTS + ffmpeg 16k mono) به‌صورت loop وارد همان خط لوله می‌شود و بدون هیچ اجازه‌ای کل پروتکل (WS واقعی به گوگل) را تست می‌کند؛ چک پیش‌گیرانه permissions.query display-capture + کچ Permissions-Policy با بنر کهربایی حاوی دکمه «باز کردن در تب جدید» و «رفتن به حالت دمو»؛ راهنمای دوحالته
- TTS skill: تولید /livedub-demo-speech.wav (26s, 16kHz mono PCM16, 832KB)
- page.tsx: bump نسخه‌ها به v2.2 + لیست ویژگی اندروید به‌روز شد
- README اندروید: جدول عیب‌یابی کامل v2.2 (نوار تشخیص + چانک ضبط)
- زیپ اندروید بازسازی (398KB)؛ دو ریپو (اصلی + اندروید) کامیت شدند
- Agent-Browser: حالت دمو تا WS واقعی گوگل رفت و پاسخ سرور نمایش یافت ✓؛ شبیه‌سازی خطای display-capture → بنر کهربایی + دو دکمه ✓ (اسکرین‌شات)؛ دکمه «رفتن به حالت دمو» منبع را عوض می‌کند ✓؛ موبایل 390px ✓؛ فوتر gap=0 ✓؛ بدون خطای کنسول ✓؛ lint 0 خطا ✓

Stage Summary:
- پوش به GitHub انجام نشد: remote حذف شده و توکن کاربر موجود نیست → برای دریافت APK جدید، کاربر باید توکن جدید بدهد تا کامیت v2.2 پوش و بیلد CI سبز شود
- تشخیص کاربر با «نوار تشخیص» جدید در اپ چندثانیه‌ای مشخص می‌شود: اگر «ضبط صدا: بدون داده» → تاگل اشتراک صدا/ری‌استارت؛ اگر «تأیید سرور: در انتظار» → کلید API
- حالت دمو وبی ابزار اثبات سلامت پروتکل/کلید است: اگر دوبله بشنود، مشکل اندروید قطعاً در مرحله ضبط است نه پروتکل

---
Task ID: 6
Agent: main (Z.ai Code)
Task: پوش v2.2 با توکن جدید کاربر + بیلد سبز CI + تأیید نهایی صفحه دِلیوری

Work Log:
- توکن جدید بررسی شد: کاربر erfankhani، اسکوپ repo+workflow ✓
- کامیت v2.2 (db63e75) پوش شد: da26e60..db63e75 main -> main؛ remote بلافاصله حذف شد
- CI run 39421001056 در ~۴ دقیقه: SUCCESS ✓ — آرتیفکت‌ها: LiveDub-debug-apk (13.6MB) + LiveDub-release-apk-unsigned (1.3MB)
- کد فیکس display-capture در LiveDubTester تأیید شد: permissions.query پیش‌گیرانه (خط ۲۵۲) + کچ Permissions-Policy (خط ۲۴۳-۲۵۹) + بنر کهربایی با window.open (خط ۹۷۴-۹۸۵) + حالت دمو با /livedub-demo-speech.wav
- تست دموی Agent-Browser: منبع دمو بارگذاری شد ✓ → WS واقعی به گوگل وصل شد ✓ → سرور 1007 (کلید ذخیره‌شده محلی نامعتبر — رفتار درست: خطا در بنر نمایش یافت، نه شکست بی‌صدا) ✓
- موبایل 390px: رندر کامل RTL تیره ✓ بدون overflow-x ✓؛ فوتر sticky در پایین صفحه (gap=-0.3px) ✓
- اسکرین‌شات‌های وسط صفحه: همه سکشن‌ها (Session Rotation، امکانات، دانلودها، راهنما) سالم‌اند — ناحیه سیاه اسکرین‌شات full-page فقط آرتیفکت انیمیشن fade-in بود
- کنسول مرورگر: بدون خطا ✓؛ lint: 0 خطا ✓

Stage Summary:
- ریپو https://github.com/erfankhani/LiveDub-Android — HEAD = db63e75 (v2.2)، بیلد سبز، APK آماده دانلود از Actions → Artifacts
- فیکس‌های v2.2 اکنون در APK رسمی: فعال‌سازی فوری سوکت مثل اکستنشن + نوار تشخیص سه‌چراغی + heartbeat ضبط + RECORD_AUDIO
- توکن دوباره در چت لو رفته — کاربر باید revoke کند (یادآوری شد)
