import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { requestVerification, confirmVerification } from '@/services/api/auth';
import { VerificationFields } from './VerificationFields';

jest.mock('@/services/api/auth', () => ({
  confirmVerification: jest.fn(),
  requestVerification: jest.fn(),
}));

const mockConfirmVerification = confirmVerification as jest.MockedFunction<typeof confirmVerification>;
const mockRequestVerification = requestVerification as jest.MockedFunction<typeof requestVerification>;

describe('VerificationFields', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockConfirmVerification.mockReset();
    mockRequestVerification.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('keeps send and confirm actions inside the right side of their input rows', async () => {
    const view = await render(<VerificationFields
      channel="email"
      purpose="login"
      target="a@example.com"
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    expect(view.getByTestId('verification-target-row')).toHaveStyle({ flexDirection: 'row' });
    expect(view.getByRole('button', { name: '发送验证码' })).toHaveStyle({ width: 104 });
    expect(view.getByTestId('verification-code-row')).toHaveStyle({ flexDirection: 'row' });
    expect(view.getByRole('button', { name: '验证验证码' })).toHaveStyle({ width: 104 });
  });

  it('sends a code, applies the cooldown accessibly, and returns the token only through the callback', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 60,
    });
    mockConfirmVerification.mockResolvedValue({ verificationToken: 'one-time-token', expiresIn: 600 });
    const onVerified = jest.fn();
    const view = await render(<VerificationFields
      channel="email"
      purpose="login"
      target="a@example.com"
      onTargetChange={jest.fn()}
      onVerified={onVerified}
    />);

    await act(async () => { fireEvent.press(view.getByRole('button', { name: '发送验证码' })); });
    expect(view.getByRole('button', { name: '60 秒后可重发' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(view.getByLabelText('验证码'), '123456');
    await act(async () => { fireEvent.press(view.getByRole('button', { name: '验证验证码' })); });

    expect(onVerified).toHaveBeenCalledWith('one-time-token');
    await view.unmount();
  });

  it('passes structured contact delivery errors to the parent without replacing them with delivery copy', async () => {
    const error = Object.assign(new Error('not registered'), { code: 'contact_not_registered' });
    mockRequestVerification.mockRejectedValue(error);
    const onError = jest.fn();
    const view = await render(<VerificationFields
      channel="email"
      purpose="login"
      target="a@example.com"
      onTargetChange={jest.fn()}
      onError={onError}
      onVerified={jest.fn()}
    />);

    await act(async () => { fireEvent.press(view.getByRole('button', { name: '发送验证码' })); });

    expect(onError).toHaveBeenCalledWith(error);
    expect(view.queryByText('验证码发送失败')).toBeNull();
    await view.unmount();
  });

  it('disables confirmation through a server retry_after cooldown', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    mockConfirmVerification.mockRejectedValue(Object.assign(new Error('wait'), { code: 'rate_limited', retryAfter: 30 }));
    const view = await render(<VerificationFields
      channel="email"
      purpose="login"
      target="a@example.com"
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    await act(async () => { fireEvent.press(view.getByRole('button', { name: '发送验证码' })); });
    await fireEvent.changeText(view.getByLabelText('验证码'), '123456');
    await act(async () => { fireEvent.press(view.getByRole('button', { name: '验证验证码' })); });

    expect(view.getByRole('button', { name: '验证验证码' }).props.accessibilityState.disabled).toBe(true);
    await view.unmount();
  });

  it('does not call onVerified when a confirmation resolves after the target changes', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    let resolveConfirmation!: (value: Awaited<ReturnType<typeof confirmVerification>>) => void;
    mockConfirmVerification.mockReturnValue(new Promise((resolve) => { resolveConfirmation = resolve; }));
    const onVerified = jest.fn();
    const props = {
      channel: 'email' as const,
      purpose: 'login' as const,
      onTargetChange: jest.fn(),
      onVerified,
    };
    const view = await render(<VerificationFields {...props} target="a@example.com" />);

    await act(async () => { fireEvent.press(view.getByRole('button', { name: '发送验证码' })); });
    await fireEvent.changeText(view.getByLabelText('验证码'), '123456');
    await act(() => { fireEvent.press(view.getByRole('button', { name: '验证验证码' })); });
    await view.rerender(<VerificationFields {...props} target="b@example.com" />);
    await act(async () => {
      resolveConfirmation({ verificationToken: 'stale-token', expiresIn: 600 });
      await Promise.resolve();
    });

    expect(onVerified).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('does not call onVerified when a confirmation resolves after unmount', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    let resolveConfirmation!: (value: Awaited<ReturnType<typeof confirmVerification>>) => void;
    mockConfirmVerification.mockReturnValue(new Promise((resolve) => { resolveConfirmation = resolve; }));
    const onVerified = jest.fn();
    const view = await render(<VerificationFields
      channel="email"
      purpose="login"
      target="a@example.com"
      onTargetChange={jest.fn()}
      onVerified={onVerified}
    />);

    await act(async () => { fireEvent.press(view.getByRole('button', { name: '发送验证码' })); });
    await fireEvent.changeText(view.getByLabelText('验证码'), '123456');
    await act(() => { fireEvent.press(view.getByRole('button', { name: '验证验证码' })); });
    await view.unmount();
    await act(async () => {
      resolveConfirmation({ verificationToken: 'stale-token', expiresIn: 600 });
      await Promise.resolve();
    });

    expect(onVerified).not.toHaveBeenCalled();
  });

  it.each([
    ['email', 'invalid-email', '请输入有效的邮箱地址'],
    ['sms', '12812345678', '请输入有效的中国大陆手机号'],
  ] as const)('rejects an invalid %s target locally', async (channel, target, message) => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'unexpected-challenge', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const view = await render(<VerificationFields
      channel={channel}
      purpose="login"
      target={target}
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));

    expect(view.getByText(message)).toBeTruthy();
    expect(mockRequestVerification).not.toHaveBeenCalled();
  });

  it.each([
    ['ops@example.com', 'email'],
    ['13812345678', 'sms'],
  ] as const)('auto-detects %s verification channel as %s', async (target, channel) => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const view = await render(<VerificationFields
      channel="auto"
      purpose="login"
      target={target}
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    expect(view.getByPlaceholderText('请输入手机号/邮箱')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));

    expect(mockRequestVerification).toHaveBeenCalledWith({ channel, purpose: 'login', target });
  });

  it('rejects an invalid auto-detected target locally', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'unexpected-challenge', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const view = await render(<VerificationFields
      channel="auto"
      purpose="login"
      target="not-a-contact"
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));

    expect(view.getByText('请输入有效的手机号或邮箱')).toBeTruthy();
    expect(mockRequestVerification).not.toHaveBeenCalled();
  });

  it.each(['13812345678', '+86 (138) 1234-5678', '0086-138-1234-5678'])(
    'accepts the supported mainland phone form %s',
    async (target) => {
      mockRequestVerification.mockResolvedValue({
        challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
      });
      const view = await render(<VerificationFields
        channel="sms"
        purpose="login"
        target={target}
        onTargetChange={jest.fn()}
        onVerified={jest.fn()}
      />);

      await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));

      expect(mockRequestVerification).toHaveBeenCalledWith({ channel: 'sms', purpose: 'login', target });
    },
  );

  it('rejects a non-six-digit verification code locally', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    mockConfirmVerification.mockResolvedValue({ verificationToken: 'unexpected-token', expiresIn: 600 });
    const view = await render(<VerificationFields
      channel="email"
      purpose="login"
      target="a@example.com"
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);
    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));
    await fireEvent.changeText(view.getByLabelText('验证码'), '12345a');

    await fireEvent.press(view.getByRole('button', { name: '验证验证码' }));

    expect(view.getByText('请输入 6 位数字验证码')).toBeTruthy();
    expect(mockConfirmVerification).not.toHaveBeenCalled();
  });

  it('invalidates the parent token before starting a resend', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const onReset = jest.fn();
    const view = await render(<VerificationFields
      channel="email"
      purpose="register"
      target="a@example.com"
      onReset={onReset}
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset.mock.invocationCallOrder[0]).toBeLessThan(mockRequestVerification.mock.invocationCallOrder[0] ?? 0);
  });

  it('reports sending busy state and releases it after success', async () => {
    let resolveSend!: (value: Awaited<ReturnType<typeof requestVerification>>) => void;
    mockRequestVerification.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const onBusyChange = jest.fn();
    const view = await render(<VerificationFields
      channel="email"
      purpose="bind_contact"
      target="a@example.com"
      onBusyChange={onBusyChange}
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    expect(view.getByRole('button', { name: '发送验证码' }).props.accessibilityState.busy).toBe(true);
    expect(view.getByLabelText('邮箱/手机号').props.editable).toBe(false);
    expect(view.getByLabelText('邮箱/手机号').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('验证码').props.editable).toBe(false);
    expect(view.getByLabelText('验证码').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      resolveSend({ challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0 });
      await Promise.resolve();
    });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it('locks both inputs while confirming and ignores a late token after the input identity changes', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    let resolveConfirmation!: (value: Awaited<ReturnType<typeof confirmVerification>>) => void;
    mockConfirmVerification.mockReturnValue(new Promise((resolve) => { resolveConfirmation = resolve; }));
    const onVerified = jest.fn();
    const props = {
      channel: 'email' as const,
      purpose: 'change_contact' as const,
      onTargetChange: jest.fn(),
      onVerified,
    };
    const view = await render(<VerificationFields {...props} target="first@example.com" />);
    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));
    await fireEvent.changeText(view.getByLabelText('验证码'), '123456');
    await fireEvent.press(view.getByRole('button', { name: '验证验证码' }));

    await waitFor(() => expect(view.getByLabelText('邮箱/手机号').props.editable).toBe(false));
    expect(view.getByRole('button', { name: '验证验证码' }).props.accessibilityState.busy).toBe(true);
    expect(view.getByLabelText('邮箱/手机号').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('验证码').props.editable).toBe(false);
    expect(view.getByLabelText('验证码').props.accessibilityState.disabled).toBe(true);
    await view.rerender(<VerificationFields {...props} target="second@example.com" />);
    await act(async () => {
      resolveConfirmation({ verificationToken: 'late-token', expiresIn: 600 });
      await Promise.resolve();
    });

    expect(onVerified).not.toHaveBeenCalled();
  });

  it('releases the parent busy state after failure and when unmounted', async () => {
    let rejectSend!: (error: Error) => void;
    mockRequestVerification.mockReturnValue(new Promise((_resolve, reject) => { rejectSend = reject; }));
    const onBusyChange = jest.fn();
    const view = await render(<VerificationFields
      channel="sms"
      purpose="change_contact"
      target="13800138000"
      onBusyChange={onBusyChange}
      onTargetChange={jest.fn()}
      onVerified={jest.fn()}
    />);

    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    await act(async () => {
      rejectSend(new Error('failed'));
      await Promise.resolve();
    });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));

    mockRequestVerification.mockReturnValue(new Promise(() => {}));
    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    await view.unmount();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('releases the parent busy state when a target change resets an in-flight request', async () => {
    mockRequestVerification.mockReturnValue(new Promise(() => {}));
    const onBusyChange = jest.fn();
    const props = {
      channel: 'email' as const,
      purpose: 'bind_contact' as const,
      onBusyChange,
      onTargetChange: jest.fn(),
      onVerified: jest.fn(),
    };
    const view = await render(<VerificationFields {...props} target="first@example.com" />);

    await fireEvent.press(view.getByRole('button', { name: '发送验证码' }));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    await view.rerender(<VerificationFields {...props} target="second@example.com" />);

    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });
});
