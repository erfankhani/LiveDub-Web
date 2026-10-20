/**
 * LiveDub AudioWorklet — ضبط PCM از ورودی صدا
 * خروجی: چانک‌های ۸۰۰ نمونه‌ای (~۵۰ms در 16kHz) به‌صورت Float32Array
 */
class LivedubPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._size = 800;
    this._buf = new Float32Array(this._size);
    this._pos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) {
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._pos++] = ch[i];
        if (this._pos === this._size) {
          this.port.postMessage(this._buf.slice(0));
          this._pos = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("livedub-pcm", LivedubPcmProcessor);
