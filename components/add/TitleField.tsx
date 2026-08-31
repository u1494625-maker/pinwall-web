export const TITLE_MAX_LENGTH = 60;

type TitleFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

/** Shared title input with a native character cap and a live remaining-count, used by both editors. */
export default function TitleField({ value, onChange }: TitleFieldProps) {
  return (
    <div>
      <input
        id="title"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={TITLE_MAX_LENGTH}
        placeholder="Add a title"
        className="w-full border-none bg-transparent text-lg font-bold text-stone-900 outline-none placeholder:font-normal placeholder:text-stone-400"
      />
      <p className="mt-1 text-right text-[11px] font-medium tabular-nums text-stone-400">
        {TITLE_MAX_LENGTH - value.length}
      </p>
    </div>
  );
}
