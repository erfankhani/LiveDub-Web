"use client";

import { motion } from "framer-motion";
import {
  AudioLines,
  Smartphone,
  Puzzle,
  RefreshCw,
  Captions,
  Volume2,
  Timer,
  ShieldCheck,
  Download,
  CheckCircle2,
  Terminal,
  Zap,
  Infinity as InfinityIcon,
  ArrowDown,
  FileCode2,
  Wrench,
  FlaskConical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import LiveDubTester from "@/components/LiveDubTester";

const fadeIn = {
  hidden: { opacity: 0, y: 22 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: i * 0.08, ease: "easeOut" as const },
  }),
};

const FEATURES = [
  {
    icon: RefreshCw,
    title: "بدون قطع ۱۵ دقیقه‌ای",
    desc: "سشن هر ~۱۳.۵ دقیقه به‌صورت خودکار تمدید می‌شود؛ سوکت جدید از قبل آماده و صدا با Hot-Swap و بافر، بدون حتی ۱ ثانیه سکوت جابه‌جا می‌شود.",
    tag: "رفع باگ اصلی",
  },
  {
    icon: Smartphone,
    title: "نسخه اندروید — دوبله هر اپ",
    desc: "با MediaProjection صدای یوتیوب، تلگرام، مرورگر و هر اپ در حال پخش گرفته می‌شود؛ نه فقط یک تب.",
    tag: "جدید",
  },
  {
    icon: Timer,
    title: "اجرای واقعی در پس‌زمینه",
    desc: "Foreground Service + Wake Lock در اندروید: دوبله حتی با صفحه خاموش ادامه دارد. در کروم هم آف‌اسکرین بدون وابستگی به پنجره پاپ‌آپ کار می‌کند.",
    tag: "بک‌گراند",
  },
  {
    icon: Captions,
    title: "زیرنویس زنده",
    desc: "گفتار ورودی و ترجمه خروجی، هم‌زمان با پخش صدا در پاپ‌آپ و اپ اندروید نمایش داده می‌شود.",
    tag: "جدید",
  },
  {
    icon: ShieldCheck,
    title: "اتصال مجدد هوشمند",
    desc: "اگر اینترنت لحظه‌ای قطع شود، با Backoff نمایی دوباره وصل می‌شود و صدای بافرشده را فلاش می‌کند.",
    tag: "پایداری",
  },
  {
    icon: Volume2,
    title: "کنترل حرفه‌ای صدا",
    desc: "اسلایدر زنده ولوم اصلی (Ducking) و دوبله در کروم؛ و در اندروید، ترفند کانال مکالمه برای چیرگی صدای دوبله.",
    tag: "کنترل",
  },
];

const ROTATION_STEPS = [
  {
    time: "دقیقه ۰",
    title: "شروع دوبله",
    desc: "سشن اول Gemini باز می‌شود و صدا به‌صورت زنده ترجمه می‌شود.",
    icon: AudioLines,
  },
  {
    time: "دقیقه ~۱۳.۵",
    title: "باز شدن سوکت دوم",
    desc: "قبل از اینکه سرور سشن را ببندد، یک سشن جدید به‌موازات قبلی باز می‌شود و صدا در بافر ذخیره می‌شود.",
    icon: FileCode2,
  },
  {
    time: "Setup Complete",
    title: "Hot-Swap بدون وقفه",
    desc: "سشن جدید تأیید می‌شود، سوکت قدیمی بسته و صدای بافرشده فلاش می‌شود — شنونده هیچ وقفه‌ای نمی‌شنود.",
    icon: Zap,
  },
];

function formatFa(n: string) {
  return n.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f0e] text-[#e8efec] overflow-x-clip">
      {/* ─────────── Nav ─────────── */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0b0f0e]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-700 to-emerald-400 grid place-items-center shadow-[0_4px_18px_rgba(16,185,129,0.35)]">
            <AudioLines className="w-5 h-5 text-[#04110c]" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-extrabold tracking-tight">LiveDub</h1>
            <p className="text-[11px] text-emerald-200/50">دوبله زنده با Gemini · v2.4</p>
          </div>
          <Badge className="hidden sm:inline-flex bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/15 rounded-full px-3">
            <Wrench className="w-3 h-3 me-1.5" /> باگ ۱۵ دقیقه رفع شد
          </Badge>
          <a href="#downloads">
            <Button size="sm" className="rounded-full bg-emerald-500 hover:bg-emerald-400 text-[#04110c] font-bold shadow-[0_4px_18px_rgba(16,185,129,0.3)]">
              <Download className="w-4 h-4 me-1" />
              دانلود
            </Button>
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* ─────────── Hero ─────────── */}
        <section className="relative">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(70% 90% at 85% 0%, rgba(16,185,129,0.14) 0%, transparent 55%), radial-gradient(60% 80% at 5% 100%, rgba(16,185,129,0.07) 0%, transparent 50%)",
            }}
          />
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-14 text-center">
            <motion.div variants={fadeIn} initial="hidden" animate="show">
              <Badge className="bg-white/5 text-emerald-300 border border-emerald-500/20 rounded-full px-4 py-1.5 text-xs mb-6 hover:bg-white/10">
                <Sparkle /> اکستنشن بازطراحی‌شده + نسخه اندروید آماده بیلد
              </Badge>
            </motion.div>

            <motion.h2
              variants={fadeIn}
              initial="hidden"
              animate="show"
              custom={1}
              className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.25]"
            >
              دوبله‌ی زنده،{" "}
              <span className="bg-gradient-to-l from-emerald-400 via-emerald-300 to-emerald-500 bg-clip-text text-transparent">
                بدون هیچ‌وقت قطع نمی‌شود
              </span>
            </motion.h2>

            <motion.p
              variants={fadeIn}
              initial="hidden"
              animate="show"
              custom={2}
              className="mt-5 text-sm sm:text-base text-emerald-100/60 leading-8 max-w-2xl mx-auto"
            >
              نسخه ۲ اکستنشن کروم با تکنیک <b className="text-emerald-300">Session Rotation</b> دیگر
              هر ۱۵ دقیقه متوقف نمی‌شود، رابط کاربری کاملاً حرفه‌ای و زیرنویس زنده دارد — و برای اولین
              بار، <b className="text-emerald-300">نسخه اندروید</b> با قابلیت دوبله‌ی هر اپلیکیشن در
              پس‌زمینه ساخته شد.
            </motion.p>

            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="show"
              custom={3}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <a href="#downloads">
                <Button size="lg" className="rounded-full h-12 px-7 bg-emerald-500 hover:bg-emerald-400 text-[#04110c] font-extrabold shadow-[0_8px_30px_rgba(16,185,129,0.35)]">
                  <Download className="w-5 h-5 me-2" />
                  دریافت فایل‌ها
                </Button>
              </a>
              <a href="#live-tester">
                <Button size="lg" className="rounded-full h-12 px-7 bg-white/5 border border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/15 hover:text-emerald-100 font-extrabold">
                  <FlaskConical className="w-4.5 h-4.5 me-2" />
                  تست زنده همین‌جا
                </Button>
              </a>
              <a href="#fix">
                <Button size="lg" variant="outline" className="rounded-full h-12 px-7 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100 font-bold">
                  ریشه‌یابی باگ ۱۵ دقیقه
                  <ArrowDown className="w-4 h-4 ms-2" />
                </Button>
              </a>
            </motion.div>

            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="show"
              custom={4}
              className="mt-10 flex flex-wrap justify-center gap-2.5"
            >
              {[
                { icon: InfinityIcon, label: "سشن بی‌نهایت" },
                { icon: Smartphone, label: "اندروید · هر اپی" },
                { icon: Captions, label: "زیرنویس زنده" },
                { icon: RefreshCw, label: "Reconnect خودکار" },
                { icon: Volume2, label: "کنترل ولوم زنده" },
              ].map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-3.5 py-1.5 text-xs text-emerald-100/70"
                >
                  <c.icon className="w-3.5 h-3.5 text-emerald-400" />
                  {c.label}
                </span>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ─────────── Live Tester: پیش‌نمایش اجرایی ─────────── */}
        <section id="live-tester" className="mx-auto max-w-6xl px-4 sm:px-6 pb-4 scroll-mt-20">
          <motion.div
            variants={fadeIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            className="text-center mb-8"
          >
            <Badge className="bg-amber-400/10 text-amber-300 border border-amber-400/25 rounded-full mb-4 hover:bg-amber-400/15">
              <FlaskConical className="w-3.5 h-3.5 me-1.5" /> پیش‌نمایش اجرایی — نسخه وب
            </Badge>
            <h3 className="text-2xl sm:text-3xl font-extrabold">اپ را همین‌جا زنده تست کنید</h3>
            <p className="mt-3 text-sm text-emerald-100/55 max-w-2xl mx-auto leading-7">
              این دقیقاً همان موتور اپ اندروید است که در مرورگر اجرا شده: ضبط صدا → Gemini Live Translate → پخش دوبله.
              برای عیب‌یابی «وصل است ولی دوبله نمی‌کند» هم عالی است — متر صدا، شمارنده بایت و لاگ کامل نشان می‌دهد مشکل کجاست.
            </p>
          </motion.div>
          <motion.div variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.05 }}>
            <LiveDubTester />
          </motion.div>
        </section>

        {/* ─────────── Fix: چرا ۱۵ دقیقه قطع می‌شد ─────────── */}
        <section id="fix" className="mx-auto max-w-6xl px-4 sm:px-6 py-14 scroll-mt-20">
          <motion.div
            variants={fadeIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="text-center mb-12"
          >
            <h3 className="text-2xl sm:text-3xl font-extrabold">
              مشکل ۱۵ دقیقه چه بود و چطور حل شد؟
            </h3>
            <p className="mt-3 text-sm text-emerald-100/55 max-w-2xl mx-auto leading-7">
              در کد قبلی، رویداد <code className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[13px]" dir="ltr">onclose</code> سوکت
              WebSocket خالی بود — یعنی وقتی سرور Gemini سشن را می‌بست، هیچ‌کس دوباره وصل نمی‌شد.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-4 mb-10">
            <motion.div variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
              <Card className="h-full bg-red-500/[0.04] border-red-500/20">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-8 h-8 rounded-lg bg-red-500/15 grid place-items-center">
                      <Timer className="w-4 h-4 text-red-400" />
                    </span>
                    <h4 className="font-extrabold text-red-300">قبلاً ❌</h4>
                  </div>
                  <ul className="space-y-2.5 text-[13px] text-red-100/70 leading-6">
                    <li>• سرور Gemini سشن WebSocket را بعد از ~۱۵ دقیقه می‌بندد (محدودیت خود API)</li>
                    <li>• <code dir="ltr" className="bg-red-500/10 px-1 rounded">onclose</code> خالی بود → هیچ اتصال مجددی وجود نداشت</li>
                    <li>• مجبور بودی استاپ بزنی و دوباره ران کنی</li>
                    <li>• UI ساده، بدون اطلاع از وضعیت اتصال</li>
                  </ul>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={fadeIn} initial="hidden" whileInView="show" custom={1} viewport={{ once: true }}>
              <Card className="h-full bg-emerald-500/[0.05] border-emerald-500/25">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-8 h-8 rounded-lg bg-emerald-500/15 grid place-items-center">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    </span>
                    <h4 className="font-extrabold text-emerald-300">حالا ✅</h4>
                  </div>
                  <ul className="space-y-2.5 text-[13px] text-emerald-100/75 leading-6">
                    <li>• <b>Session Rotation:</b> دقیقه ~۱۳.۵ سوکت دوم از قبل باز می‌شود</li>
                    <li>• صدا در حین جابه‌جایی در بافر (تا ~۱۲ ثانیه) ذخیره و بعداً فلاش می‌شود</li>
                    <li>• <code dir="ltr" className="bg-emerald-500/10 px-1 rounded">goAway</code> سرور هم فوراً تمدید می‌کند</li>
                    <li>• قطعی‌های اینترنت با Backoff نمایی خودکار جبران می‌شوند</li>
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* timeline */}
          <div className="grid sm:grid-cols-3 gap-4">
            {ROTATION_STEPS.map((s, i) => (
              <motion.div
                key={i}
                variants={fadeIn}
                initial="hidden"
                whileInView="show"
                custom={i}
                viewport={{ once: true }}
                className="relative"
              >
                <Card className="h-full bg-white/[0.03] border-white/8">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="w-10 h-10 rounded-xl bg-emerald-500/12 border border-emerald-500/20 grid place-items-center">
                        <s.icon className="w-5 h-5 text-emerald-400" />
                      </span>
                      <Badge className="bg-transparent border border-white/10 text-emerald-200/70 text-[10px] rounded-full hover:bg-transparent">
                        {formatFa(s.time)}
                      </Badge>
                    </div>
                    <h5 className="font-bold text-[14px] mb-1.5">{s.title}</h5>
                    <p className="text-[12px] text-emerald-100/55 leading-6">{s.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <motion.div variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true }} className="mt-8">
            <Accordion type="single" collapsible className="bg-white/[0.03] border border-white/8 rounded-xl px-4">
              <AccordionItem value="tech" className="border-white/8">
                <AccordionTrigger className="text-[14px] font-bold hover:no-underline text-emerald-200">
                  جزئیات فنی پیاده‌سازی (برای کنجکاوها 🤓)
                </AccordionTrigger>
                <AccordionContent className="text-[13px] text-emerald-100/60 leading-7">
                  موتور دوبله در سند Offscreen اجرا می‌شود که مستقل از پاپ‌آپ و سرویس‌ورکر کار می‌کند.
                  تایمر <code dir="ltr" className="text-emerald-300">SESSION_ROTATE_MS = 13.5min</code> هر بار سوکت جدیدی را به‌موازات
                  سوکت فعال باز می‌کند؛ بعد از دریافت <code dir="ltr" className="text-emerald-300">setupComplete</code>، سوکت قدیمی بسته و
                  چانک‌های بافرشده (هر چانک ~۵۰ms) به سوکت جدید فلاش می‌شوند. پیام{" "}
                  <code dir="ltr" className="text-emerald-300">goAway</code> سرور هم به‌عنوان علامت تمدید فوری استفاده می‌شود. در قطعی
                  غیرمنتظره، تلاش مجدد با تأخیر ۱.۲s → ۲.۴s → … (سقف ۱۰s) انجام می‌شود. همین منطق دقیقاً در سرویس Foreground
                  نسخه اندروید (GeminiLiveClient.kt) هم پیاده شده است.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </motion.div>
        </section>

        {/* ─────────── Features ─────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <motion.div
            variants={fadeIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="text-center mb-10"
          >
            <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 rounded-full mb-4 hover:bg-emerald-500/15">
              <Sparkle /> همه‌چیز که خواستی + چیزهایی که لازم داشتی
            </Badge>
            <h3 className="text-2xl sm:text-3xl font-extrabold">امکانات نسخه ۲</h3>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                variants={fadeIn}
                initial="hidden"
                whileInView="show"
                custom={i % 3}
                viewport={{ once: true }}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
              >
                <Card className="h-full bg-white/[0.03] border-white/8 hover:border-emerald-500/30 hover:bg-emerald-500/[0.04] transition-colors">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-600/25 to-emerald-400/10 border border-emerald-500/20 grid place-items-center">
                        <f.icon className="w-5 h-5 text-emerald-400" />
                      </span>
                      <Badge className="bg-transparent border border-emerald-500/25 text-emerald-300/80 text-[10px] rounded-full hover:bg-transparent">
                        {f.tag}
                      </Badge>
                    </div>
                    <h4 className="font-extrabold text-[15px] mb-2">{f.title}</h4>
                    <p className="text-[12.5px] text-emerald-100/55 leading-7">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─────────── Downloads ─────────── */}
        <section id="downloads" className="mx-auto max-w-6xl px-4 sm:px-6 py-14 scroll-mt-20">
          <motion.div
            variants={fadeIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="text-center mb-10"
          >
            <h3 className="text-2xl sm:text-3xl font-extrabold">دانلود فایل‌ها</h3>
            <p className="mt-3 text-sm text-emerald-100/55">
              هر دو بسته آماده‌اند — اکستنشن را مستقیم نصب کن، اندروید را در Android Studio بیلد کن.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-5">
            <motion.div variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
              <Card className="h-full bg-gradient-to-b from-emerald-500/[0.07] to-transparent border-emerald-500/25">
                <CardContent className="p-7">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 grid place-items-center">
                      <Puzzle className="w-6 h-6 text-emerald-400" />
                    </span>
                    <div>
                      <h4 className="font-extrabold text-[16px]">اکستنشن کروم — v2.0</h4>
                      <p className="text-[11px] text-emerald-100/50">ZIP · {formatFa("47")} کیلوبایت</p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-[13px] text-emerald-100/70 leading-7 mb-6">
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> رفع کامل قطع‌شدن ۱۵ دقیقه‌ای</li>
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> پاپ‌آپ حرفه‌ای جدید + زیرنویس زنده</li>
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> آمار زنده + کنترل ولوم + آیکون اختصاصی</li>
                  </ul>
                  <a href="/downloads/livedub-extension-v2.zip" download>
                    <Button className="w-full h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#04110c] font-extrabold">
                      <Download className="w-4.5 h-4.5 me-2" />
                      دانلود اکستنشن
                    </Button>
                  </a>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={fadeIn} initial="hidden" whileInView="show" custom={1} viewport={{ once: true }}>
              <Card className="h-full bg-gradient-to-b from-white/[0.05] to-transparent border-white/12">
                <CardContent className="p-7">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="w-12 h-12 rounded-2xl bg-white/8 border border-white/12 grid place-items-center">
                      <Smartphone className="w-6 h-6 text-emerald-300" />
                    </span>
                    <div>
                      <h4 className="font-extrabold text-[16px]">سورس اندروید — Kotlin + Compose · v2.4</h4>
                      <p className="text-[11px] text-emerald-100/50">ZIP · {formatFa("398")} کیلوبایت</p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-[13px] text-emerald-100/70 leading-7 mb-6">
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> دوبله هر اپ (یوتیوب و…) با MediaProjection</li>
                      <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> دو اسلایدر زنده: صدای دوبله + صدای اصلی (بدون زیرنویس — v2.4)</li>
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> اجرا در پس‌زمینه + صفحه خاموش (FGS + Wake Lock)</li>
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-1" /> Session Rotation + نوار تشخیص زنده (سوکت / تأیید سرور / ضبط)</li>
                  </ul>
                  <a href="/downloads/livedub-android-source.zip" download>
                    <Button variant="outline" className="w-full h-11 rounded-xl border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100 font-extrabold">
                      <Download className="w-4.5 h-4.5 me-2" />
                      دانلود سورس اندروید
                    </Button>
                  </a>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ─────────── Guides ─────────── */}
        <section className="mx-auto max-w-4xl px-4 sm:px-6 py-14">
          <motion.h3
            variants={fadeIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="text-2xl sm:text-3xl font-extrabold text-center mb-8"
          >
            راهنمای نصب
          </motion.h3>

          <motion.div variants={fadeIn} initial="hidden" whileInView="show" viewport={{ once: true }}>
            <Tabs defaultValue="chrome" dir="rtl" className="w-full">
              <TabsList className="grid grid-cols-2 w-full max-w-xs mx-auto bg-white/5 border border-white/8 rounded-xl h-11 p-1">
                <TabsTrigger value="chrome" className="rounded-lg data-[state=active]:bg-emerald-500 data-[state=active]:text-[#04110c] font-bold text-[13px]">
                  🧩 کروم
                </TabsTrigger>
                <TabsTrigger value="android" className="rounded-lg data-[state=active]:bg-emerald-500 data-[state=active]:text-[#04110c] font-bold text-[13px]">
                  📱 اندروید
                </TabsTrigger>
              </TabsList>

              <TabsContent value="chrome" className="mt-6">
                <Card className="bg-white/[0.03] border-white/8">
                  <CardContent className="p-6 sm:p-8">
                    <ol className="space-y-4">
                      {[
                        <>زیپ اکستنشن را دانلود و باز (Extract) کنید.</>,
                        <>در کروم به آدرس <code dir="ltr" className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">chrome://extensions</code> بروید.</>,
                        <>گزینه <b>Developer mode</b> را در بالا-راست روشن کنید.</>,
                        <>روی <b>Load unpacked</b> بزنید و پوشه باز‌شده اکستنشن را انتخاب کنید.</>,
                        <>کلید رایگان Gemini API را از <b dir="ltr">aistudio.google.com</b> بگیرید و در پاپ‌آپ وارد کنید.</>,
                        <>زبانه‌ای که می‌خواهید دوبله شود (مثلاً یوتیوب) را باز کنید → آیکون LiveDub → «شروع دوبله» 🎉</>,
                      ].map((step, i) => (
                        <li key={i} className="flex gap-3.5">
                          <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 grid place-items-center text-[12px] font-extrabold text-emerald-300">
                            {formatFa(String(i + 1))}
                          </span>
                          <p className="text-[13.5px] text-emerald-100/75 leading-7 pt-0.5">{step}</p>
                        </li>
                      ))}
                    </ol>
                    <Separator className="my-5 bg-white/8" />
                    <p className="text-[12px] text-emerald-100/50 leading-6">
                      💡 بعد از شروع، پاپ‌آپ را ببندید — دوبله در پس‌زمینه ادامه دارد. آمار و زیرنویس را هر وقت خواستی با کلیک دوباره روی آیکون ببین.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="android" className="mt-6">
                <Card className="bg-white/[0.03] border-white/8">
                  <CardContent className="p-6 sm:p-8">
                    {/* ⭐ مسیر سریع: APK آماده از GitHub Releases (بدون Android Studio) */}
                    <div className="mb-6 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5">
                      <div className="flex items-start gap-3.5">
                        <span className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 grid place-items-center">
                          <Download className="w-5 h-5 text-emerald-300" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold text-emerald-200">
                            ⚡ سریع‌ترین راه — APK آماده را از GitHub Releases دانلود کنید
                          </p>
                          <p className="text-[12.5px] text-emerald-100/60 leading-6 mt-1">
                            بدون Android Studio! فایل <b dir="ltr">LiveDub-*-debug.apk</b> را نصب کنید.
                            نسخه v2.4.0: بدون زیرنویس + دو اسلایدر زنده «صدای دوبله» و «صدای اصلی». لینک Releases هرگز منقضی نمی‌شود.
                          </p>
                          <div className="flex flex-wrap gap-2.5 mt-3.5">
                            <a href="https://github.com/erfankhani/LiveDub-Android/releases/latest" target="_blank" rel="noreferrer">
                              <Button size="sm" className="h-9 bg-emerald-500 hover:bg-emerald-400 text-[#052018] font-bold">
                                <Download className="w-4 h-4 me-1.5" /> دانلود APK از Releases
                              </Button>
                            </a>
                            <a href="https://github.com/erfankhani/LiveDub-Android/releases/latest" target="_blank" rel="noreferrer">
                              <Button size="sm" variant="outline" className="h-9 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">
                                دانلود مستقیم (آخرین نسخه)
                              </Button>
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                    <Separator className="mb-6 bg-white/8" />
                    <p className="text-[12px] text-emerald-100/45 mb-4">
                      🛠 راه دوم (توسعه‌دهندگان): بیلد محلی با Android Studio از سورس:
                    </p>
                    <ol className="space-y-4">
                      {[
                        <>Android Studio (نسخه Koala یا جدیدتر) و JDK 17 نصب کنید.</>,
                        <>زیپ سورس را Extract کنید و پوشه <b dir="ltr">LiveDubAndroid</b> را در Studio باز کنید.</>,
                        <>صبر کنید Gradle سینک شود (اگر wrapper خطا داد: <code dir="ltr" className="text-emerald-300 bg-emerald-500/10 px-1 rounded">gradle wrapper --gradle-version 8.9</code>).</>,
                        <>از منو: <b>Build → Build Bundle(s)/APK(s) → Build APK(s)</b></>,
                        <>APK از مسیر <code dir="ltr" className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">app/build/outputs/apk/debug/</code> را روی گوشی نصب کنید (اندروید ۱۰ به بالا).</>,
                        <>کلید API را وارد کنید → «شروع دوبله» → اجازه ضبط صدا → به یوتیوب بروید و پخش کنید 🎉</>,
                      ].map((step, i) => (
                        <li key={i} className="flex gap-3.5">
                          <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 grid place-items-center text-[12px] font-extrabold text-emerald-300">
                            {formatFa(String(i + 1))}
                          </span>
                          <p className="text-[13.5px] text-emerald-100/75 leading-7 pt-0.5">{step}</p>
                        </li>
                      ))}
                    </ol>
                    <Separator className="my-5 bg-white/8" />
                    <div dir="ltr" className="rounded-xl border border-white/10 bg-[#0d1412] p-4 font-mono text-[12px] text-emerald-200/80 overflow-x-auto whitespace-pre leading-6">
                      <div className="flex items-center gap-2 text-emerald-100/40 text-[11px] mb-2 font-sans">
                        <Terminal className="w-3.5 h-3.5" /> terminal
                      </div>
                      {`cd LiveDubAndroid
gradle wrapper --gradle-version 8.9   # only if gradlew is missing
./gradlew assembleDebug`}
                    </div>
                    <p className="text-[12px] text-emerald-100/50 leading-6 mt-4">
                      💡 با فعال‌کردن گزینه «پخش روی کانال مکالمه»، ولوم رسانه گوشی را کم کنید تا صدای اصلی اپ‌ها کم شود اما دوبله بلند بماند.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </section>
      </main>

      {/* ─────────── Footer (sticky bottom) ─────────── */}
      <footer className="mt-auto border-t border-white/5 bg-[#0d1211]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2.5 flex-1">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-700 to-emerald-400 grid place-items-center">
              <AudioLines className="w-4 h-4 text-[#04110c]" strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-[12.5px] font-bold">LiveDub v2.4</p>
              <p className="text-[10.5px] text-emerald-100/40">دوبله زنده با Gemini Live Translate</p>
            </div>
          </div>
          <p className="text-[11px] text-emerald-100/40 text-center sm:text-left">
            ساخته‌شده با ❤️ — اکستنشن کروم + اندروید · بدون قطعی ۱۵ دقیقه‌ای
          </p>
        </div>
      </footer>
    </div>
  );
}

function Sparkle() {
  return <SparkleIcon />;
}

function SparkleIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 me-1.5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l2.1 6.2L20 10l-5.9 1.8L12 18l-2.1-6.2L4 10l5.9-1.8L12 2z" />
    </svg>
  );
}
