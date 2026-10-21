package com.livedub.app.dubbing

import java.util.ArrayList

/**
 * تبدیل نرخ نمونه PCM16 مونو با ضریب صحیح (48kHz → 16kHz، فاکتور ۳)
 * با میانگین‌گیری (box filter) — مناسب گفتار و سبک
 * باقیمانده نمونه‌ها بین فراخوانی‌ها حفظ می‌شود تا جریان بدون درز باشد
 */
class PcmResampler(private val fromRate: Int, private val toRate: Int) {

    private val factor: Int =
        if (toRate > 0 && fromRate % toRate == 0) fromRate / toRate else 1

    private val remainder = ArrayList<Short>()

    fun resample(input: ShortArray): ShortArray {
        if (factor == 1) return input

        val all: ShortArray = if (remainder.isEmpty()) input else run {
            val merged = ShortArray(remainder.size + input.size)
            for (i in remainder.indices) merged[i] = remainder[i]
            System.arraycopy(input, 0, merged, remainder.size, input.size)
            merged
        }
        remainder.clear()

        val usable = all.size - (all.size % factor)
        if (usable <= 0) {
            for (i in usable until all.size) remainder.add(all[i])
            return ShortArray(0)
        }
        for (i in usable until all.size) remainder.add(all[i])

        val outLen = usable / factor
        val out = ShortArray(outLen)
        for (i in 0 until outLen) {
            var sum = 0
            val base = i * factor
            for (j in 0 until factor) sum += all[base + j].toInt()
            out[i] = (sum / factor).toShort()
        }
        return out
    }
}
