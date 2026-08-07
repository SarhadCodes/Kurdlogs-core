export interface ConcatInputOptions {
  loop: boolean;
  decoderThreads?: number;
}

/** Add the canonical realtime concat input used by playlist playout. */
export function appendConcatInputArgs(
  args: string[],
  concatPath: string,
  options: ConcatInputOptions
): void {
  if (options.loop) {
    args.push('-stream_loop', '-1');
  }
  args.push(
    '-re',
    '-fflags', '+genpts+igndts+discardcorrupt',
    '-thread_queue_size', '2048',
    ...(options.decoderThreads ? ['-threads', String(options.decoderThreads)] : []),
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath
  );
}
