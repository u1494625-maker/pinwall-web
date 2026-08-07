const feedTabs = ["Following", "Explore"];

type CategoryChipsProps = {
  selectedTab: string;
  onSelectTab: (tab: string) => void;
};

export default function CategoryChips({ selectedTab, onSelectTab }: CategoryChipsProps) {
  return (
    <div className="flex gap-6">
      {feedTabs.map((tab) => {
        const isSelected = tab === selectedTab;

        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelectTab(tab)}
            aria-pressed={isSelected}
            className={`relative py-1.5 text-[15px] font-bold transition-colors ${
              isSelected ? "text-stone-900" : "text-stone-400"
            }`}
          >
            {tab}
            {isSelected ? (
              <span className="absolute inset-x-0 -bottom-1.5 h-[2.5px] rounded-full bg-orange-500" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
