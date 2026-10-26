import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';

let parsing = false;

/** No queue: overlapping uploads must retry rather than retaining input buffers. */
export const parseCatalogueCells = async (bytes: Buffer, format: 'csv' | 'xlsx'): Promise<string[][]> => {
  if (parsing) throw new Error('Another catalogue is being read. Please retry shortly.');
  parsing = true;
  let worker: Worker | undefined;
  try {
    return await new Promise<string[][]>((resolveResult, reject) => {
      worker = new Worker(resolve(__dirname, '../../tools/catalogue-worker.cjs'), {
        workerData: { bytes, format },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      const timeout = setTimeout(() => reject(new Error('Catalogue reading timed out. Use a smaller workbook.')), 10000);
      worker.once('message', result => {
        clearTimeout(timeout);
        if (result.error) reject(new Error(result.error));
        else resolveResult(result.rows);
      });
      worker.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('The workbook exceeded the parser resource limit or could not be read.'));
      });
      worker.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('The workbook reader stopped before completing.'));
      });
    });
  } finally {
    // Hold the slot until the old worker and its external buffers are gone.
    try { await worker?.terminate(); } finally { parsing = false; }
  }
};
