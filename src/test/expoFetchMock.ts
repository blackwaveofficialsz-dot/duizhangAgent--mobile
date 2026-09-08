export const fetch = jest.fn(
  (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
);
