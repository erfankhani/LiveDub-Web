/**
 * LiveDub — AudioWorklet Processor
 * ورودی صدا را در چانک‌های ~۳۰ms (16kHz) به thread اصلی می‌فرستد
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.chunkSize = 480; // ~۳۰ms در ۱۶kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this.buffer.push(channel[i]);
      }
      while (this.buffer.length >= this.chunkSize) {
        const chunk = this.buffer.splice(0, this.chunkSize);
        this.port.postMessage(chunk);
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
