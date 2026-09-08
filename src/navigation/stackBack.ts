type StackBackNavigation = {
  getState: () => { index: number } | undefined;
  goBack: () => void;
};

export function goBackOneLevel(navigation: StackBackNavigation, fallback: () => void) {
  if ((navigation.getState()?.index ?? 0) > 0) {
    navigation.goBack();
    return;
  }
  fallback();
}
