import { fireEvent, render, screen } from '@testing-library/react-native';

import { SignInScreen } from '../SignInScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockSignIn = jest.fn();

jest.mock('../../store/auth', () => ({
  useAuthStore: (selector: (state: { signIn: jest.Mock }) => unknown) =>
    selector({ signIn: mockSignIn }),
}));

type ScreenProps = Parameters<typeof SignInScreen>[0];

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as ScreenProps['navigation'];

const route = { key: 'SignIn-1', name: 'SignIn' } as ScreenProps['route'];

function renderScreen() {
  return render(<SignInScreen navigation={navigation} route={route} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SignInScreen', () => {
  it('renders the email and password fields and the submit button', async () => {
    await renderScreen();

    expect(screen.getByTestId('email-input')).toBeTruthy();
    expect(screen.getByTestId('password-input')).toBeTruthy();
    expect(screen.getByTestId('sign-in-button')).toBeTruthy();
  });

  it('shows validation errors when submitting an empty form', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId('sign-in-button'));

    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(await screen.findByText('Enter your password')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('submits valid credentials to the auth store', async () => {
    mockSignIn.mockResolvedValue({ error: null });
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('email-input'), 'user@example.com');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'secret123');
    await fireEvent.press(screen.getByTestId('sign-in-button'));

    expect(mockSignIn).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secret123',
    });
    expect(screen.queryByTestId('form-error')).toBeNull();
  });

  it('surfaces auth errors returned by the store', async () => {
    mockSignIn.mockResolvedValue({ error: 'Incorrect email or password.' });
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('email-input'), 'user@example.com');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('sign-in-button'));

    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy();
  });

  it('navigates to sign up and forgot password', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByText('Create an account'));
    expect(navigation.navigate).toHaveBeenCalledWith('SignUp');

    await fireEvent.press(screen.getByText('Forgot your password?'));
    expect(navigation.navigate).toHaveBeenCalledWith('ForgotPassword');
  });
});
