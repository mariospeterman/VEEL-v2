export function Select<T extends string>({
  label,
  onChange,
  options,
  optionLabel,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  options: T[];
  optionLabel?: (value: T) => string;
  value: T;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-(--muted)">{label}</span>
      <select
        className="rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
        onChange={(event) => onChange(event.currentTarget.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel ? optionLabel(option) : option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumberInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-(--muted)">{label}</span>
      <input
        className="rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
        min="0"
        onChange={(event) => onChange(event.currentTarget.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}
