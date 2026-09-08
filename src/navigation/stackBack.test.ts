import { goBackOneLevel } from './stackBack';

describe('goBackOneLevel', () => {
  it('goes back once inside the current Stack', () => {
    const goBack = jest.fn();
    const fallback = jest.fn();

    goBackOneLevel({ getState: () => ({ index: 2 }), goBack }, fallback);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the local fallback instead of bubbling to the parent navigator', () => {
    const goBack = jest.fn();
    const fallback = jest.fn();

    goBackOneLevel({ getState: () => ({ index: 0 }), goBack }, fallback);

    expect(goBack).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
