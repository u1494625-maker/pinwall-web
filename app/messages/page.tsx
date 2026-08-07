import Link from "next/link";
import RequireAuth from "@/components/auth/RequireAuth";
import DemoPhoto from "@/components/DemoPhoto";
import { demoConversations } from "@/data/demoData";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-5">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <path d="M12 21s-6.7-4.35-9.3-8.1C1 10.1 1.6 6.6 4.6 5.2c2.2-1 4.6-.2 5.9 1.6l1.5 2 1.5-2c1.3-1.8 3.7-2.6 5.9-1.6 3 1.4 3.6 4.9 1.9 7.7C18.7 16.65 12 21 12 21Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

const messageShortcuts = [
  { label: "Likes & Saves", accent: "bg-rose-100 text-rose-500", Icon: HeartIcon },
  { label: "New followers", accent: "bg-blue-100 text-blue-500", Icon: PersonIcon },
  { label: "Comments & @", accent: "bg-emerald-100 text-emerald-500", Icon: ChatIcon },
];

export default function MessagesPage() {
  return (
    <RequireAuth>
      <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-28 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
        <header className="relative px-5 pb-1 pt-8 text-center">
          <h1 className="text-2xl font-black tracking-tight text-stone-900">Messages</h1>
          <div className="absolute right-5 top-8 flex items-center gap-1 text-stone-500">
            <Link
              href="/search"
              aria-label="Search"
              className="grid size-9 place-items-center rounded-full transition-colors hover:bg-stone-100"
            >
              <SearchIcon />
            </Link>
            <button
              type="button"
              aria-label="New message"
              className="grid size-9 place-items-center rounded-full transition-colors hover:bg-stone-100"
            >
              <ComposeIcon />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-3 px-5 pb-4 pt-5">
          {messageShortcuts.map(({ label, accent, Icon }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-center">
              <div className={`grid size-12 place-items-center rounded-2xl ${accent}`}>
                <Icon />
              </div>
              <span className="text-[11px] font-semibold leading-tight text-stone-600">{label}</span>
            </div>
          ))}
        </div>

        <div className="px-2 pt-2">
          {demoConversations.map((conversation) => (
            <article key={conversation.id} className="flex items-center gap-3 px-3 py-3.5">
              <DemoPhoto
                src={conversation.avatar}
                alt={`${conversation.name} profile photo`}
                className="size-14 shrink-0 rounded-full"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="truncate text-[15px] font-bold text-stone-900">{conversation.name}</h2>
                  <time className="shrink-0 text-[11px] font-medium text-stone-400">{conversation.time}</time>
                </div>
                <p
                  className={`mt-1 truncate text-[13px] ${
                    conversation.unread ? "font-semibold text-stone-700" : "text-stone-500"
                  }`}
                >
                  {conversation.preview}
                </p>
              </div>
              {conversation.unread > 0 && (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                  {conversation.unread}
                </span>
              )}
            </article>
          ))}
        </div>
      </main>
    </RequireAuth>
  );
}
