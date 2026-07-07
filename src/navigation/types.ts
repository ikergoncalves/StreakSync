import { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

export type AppTabParamList = {
  Today: undefined;
  Groups: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<AppTabParamList>;
  /** Create when habitId is absent, edit when present. */
  HabitForm: { habitId?: string } | undefined;
  HabitDetail: { habitId: string };
  CreateGroup: undefined;
  /** Also the deep-link target (streaksync://join/CODE) — code pre-fills the input. */
  JoinGroup: { code?: string } | undefined;
  /** Replay of the intro from Profile — never touches the "seen" flag. */
  Onboarding: undefined;
};
