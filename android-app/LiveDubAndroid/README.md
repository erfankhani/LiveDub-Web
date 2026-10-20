# LiveDub Android 🎙️ — دوبله زنده هر اپلیکیشن

نسخه اندروید اکستنشن «دوبله زنده تب» کروم — با این تفاوت که اینجا **صدای هر اپلیکیشن در حال پخش** (یوتیوب، تلگرام، مرورگر، پادکست و…) را می‌گیرد و **در پس‌زمینه** دوبله می‌کند.

## ✨ قابلیت‌ها

- **دوبله هر اپ**: با MediaProjection + AudioPlaybackCapture، صدای هر اپ در حال پخش ضبط می‌شود (API 29+)
- **اجرای در پس‌زمینه**: Foreground Service + Wake Lock → حتی با صفحه خاموش ادامه می‌دهد
- **بدون قطع ۱۵ دقیقه‌ای**: Session Rotation خودکار (~۱۳.۵ دقیقه) + Hot-Swap سوکت + بافر صدا = دوبله بدون هیچ وقفه‌ای
- **اتصال مجدد هوشمند**: Backoff نمایی در قطعی اینترنت
- **زیرنویس زنده**: نمایش گفتار ورودی و ترجمه خروجی
- **کانال مکالمه (ترفند حرفه‌ای)**: ولوم رسانه را کم کنید → صدای اصلی کم می‌شود ولی دوبله روی ولوم مکالمه بلند می‌ماند
- رابط کاربری مدرن و تیره با Jetpack Compose + RTL فارسی

## 🛠 ساخت APK

### روش ۱: Android Studio (پیشنهادی)
1. پروژه را در Android Studio باز کنید (`File > Open` → پوشه `LiveDubAndroid`)
2. منتظر همگام‌سازی Gradle بمانید (اگر خطای wrapper داد: `File > Sync Project with Gradle Files` یا در ترمینال `gradle wrapper --gradle-version 8.9`)
3. `Build > Build Bundle(s)/APK(s) > Build APK(s)`
4. APK در `app/build/outputs/apk/debug/app-debug.apk` ساخته می‌شود

### روش ۲: خط فرمان
```bash
cd LiveDubAndroid
gradle wrapper --gradle-version 8.9   # اگر gradlew موجود نیست
./gradlew assembleDebug
# خروجی: app/build/outputs/apk/debug/app-debug.apk
```

> ⚙️ **نیازمندی‌ها**: JDK 17، Android SDK 35، Gradle 8.9، AGP 8.5.2

## 📱 استفاده

1. کلید Gemini API را وارد کنید (دریافت رایگان از [aistudio.google.com](https://aistudio.google.com))
2. زبان خروجی را انتخاب کنید
3. «شروع دوبله» → اجازه نوتیفیکیشن → اجازه ضبط صدا (MediaProjection)
4. به هر اپی بروید و محتوا پخش کنید — دوبله روی همان صدا پخش می‌شود

## ⚠️ نکات مهم

- صدای اپ‌هایی که خودشان اجازه ضبط نداده‌اند (موسیقی DRM، تماس‌ها) قابل کپچر نیست
- صدای اپ LiveDub خودش کپچر نمی‌شود (بدون فیدبک)
- اندروید امکان کم کردن صدای «اپ دیگر» را نمی‌دهد؛ برای چیرگی صدای دوبله از گزینه «پخش روی کانال مکالمه» استفاده کنید
- مدل استفاده‌شده: `gemini-3.5-live-translate-preview` (همان مدل نسخه کروم)

## 📂 ساختار

```
app/src/main/java/com/livedub/app/
├── MainActivity.kt            # UI (Jetpack Compose، تم تیره، RTL)
├── ui/AppScreen.kt            # صفحه اصلی و کامپوننت‌ها
├── ui/theme/Theme.kt          # پالت سبز زمردی تیره
└── dubbing/
    ├── LiveDubService.kt      # سرویس Foreground + بافر صدا + Wake Lock
    ├── GeminiLiveClient.kt    # WebSocket + Session Rotation + Reconnect
    ├── AudioCaptureEngine.kt  # AudioPlaybackCapture (صدای همه اپ‌ها)
    ├── AudioPlayerEngine.kt   # AudioTrack پخش 24kHz + کانال مکالمه
    └── PcmResampler.kt        # 48kHz → 16kHz
```
