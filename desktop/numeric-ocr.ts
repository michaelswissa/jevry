import { createWorker, PSM, type Worker } from 'tesseract.js';
import language from '@tesseract.js-data/eng';
import { resolve } from 'node:path';

/** One local worker, bundled language data, no network or page scripts. */
class NumericOcr {
  private pending?: Promise<Worker>;
  private queue: Promise<unknown> = Promise.resolve();
  private async worker() {
    if (!this.pending) this.pending = (async () => {
      const langPath = language.langPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      const worker = await createWorker('eng', 1, {
        langPath, workerPath: resolve(langPath, '../../../tesseract.js/src/worker-script/node/index.js'),
        cacheMethod: 'none', gzip: true, errorHandler: () => {},
      }, {load_system_dawg:'0',load_freq_dawg:'0',load_punc_dawg:'0',load_number_dawg:'0',load_unambig_dawg:'0',load_bigram_dawg:'0'});
      // A tile is a line of digits. Word segmentation unnecessarily penalizes single
      // digits and short numbers, causing correct reads to fail confidence checks.
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_LINE });
      return worker;
    })().catch(error => { this.pending = undefined; throw error; });
    return this.pending;
  }
  read(image: Buffer, signal?: AbortSignal): Promise<{text:string;confidence:number}> {
    const task = this.queue.then(async () => {
      signal?.throwIfAborted();
      const worker = await this.worker();
      const thread = (worker as Worker & {worker:{ref():void;unref():void}}).worker;
      thread.ref();
      try {
        signal?.throwIfAborted();
        const {data} = await worker.recognize(image);
        signal?.throwIfAborted();
        return {text:data.text.trim(),confidence:data.confidence};
      } finally { thread.unref(); }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async close() { await this.queue; const worker = await this.pending; this.pending = undefined; await worker?.terminate(); }
}
export const numericOcr = new NumericOcr();
