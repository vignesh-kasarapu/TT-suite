/** react-native-web's Alert.alert is a hard no-op (`static alert() {}` — see
 * node_modules/react-native-web/src/exports/Alert/index.js) — it never
 * renders anything and never calls a button's onPress, on any browser. Every
 * screen in this app calls Alert.alert for both destructive-action confirms
 * and plain success/error messages, so on web none of that ever fired: no
 * confirm dialog, no error surfaced, no onPress ever invoked. This module is
 * a drop-in replacement — same {title, message, buttons} call shape — that
 * delegates to the real native Alert on iOS/Android and to window.confirm/
 * window.alert (real, synchronous, actually-supported browser APIs) on web. */
import { Alert as RNAlert, Platform } from 'react-native';

interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

function alert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons);
    return;
  }

  const full = [title, message].filter(Boolean).join('\n\n');

  if (!buttons || buttons.length <= 1) {
    window.alert(full);
    buttons?.[0]?.onPress?.();
    return;
  }

  const confirmButton = buttons.find((b) => b.style !== 'cancel') ?? buttons[buttons.length - 1];
  const cancelButton = buttons.find((b) => b.style === 'cancel');
  if (window.confirm(full)) {
    confirmButton.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}

export const Alert = { alert };
