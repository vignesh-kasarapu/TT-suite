// A styled dropdown (Radix Select): each option can carry an icon and a one-line hint.
import * as Select from "@radix-ui/react-select";
import { Icon, type IconName } from "./Icon";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  icon?: IconName;
}

export function Picker({ id, value, onChange, options, placeholder, disabled }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: PickerOption[];
  placeholder: string;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger id={id} className="picker-trigger" aria-label={placeholder}>
        <span className="picker-value">
          {current?.icon && <span className="picker-ico"><Icon name={current.icon} /></span>}
          <Select.Value placeholder={<span className="muted">{placeholder}</span>}>{current?.label}</Select.Value>
        </span>
        <Select.Icon className="picker-chev"><Icon name="chevdown" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="picker-content" position="popper" sideOffset={4}>
          <Select.Viewport className="picker-viewport">
            {options.map((o) => (
              <Select.Item key={o.value} value={o.value} className="picker-item">
                {o.icon && <span className="picker-ico"><Icon name={o.icon} /></span>}
                <span className="picker-text">
                  <Select.ItemText>{o.label}</Select.ItemText>
                  {o.hint && <span className="picker-hint"> · {o.hint}</span>}
                </span>
                <Select.ItemIndicator className="picker-tick"><Icon name="check" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
