import { parseSse } from './parseSse';


function streamOf(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}


describe('parseSse terminal contract', () => {
  it('stops after an error frame', async () => {
    const events = [];
    const body = streamOf(
      'data: {"type":"error","message":"failed","code":"boom"}\n\n'
      + 'data: {"type":"text","content":"must not arrive"}\n\n',
    );

    for await (const event of parseSse(body)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'error', message: 'failed', code: 'boom', retryable: false },
    ]);
  });
});
