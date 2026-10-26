// NFR-036: every user-facing string lives in en.json; components call t(key, params).
import en from './en.json';

export type MessageKey = keyof typeof en;
const messages: Record<string, string> = en;

export function t(key: MessageKey | string, params?: Record<string, string | number>): string {
  const template = messages[key];
  if (template === undefined) return `[${key}]`; // visible in the UI and in tests, never silent
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

export function hasMessage(key: string): boolean {
  return key in messages;
}
