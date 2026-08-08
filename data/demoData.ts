// ===== DEMO CONTENT START =====
// Everything in this file is removable sample content for the PinWall demo.

function commonsPhoto(filename: string, width = 900) {
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}?width=${width}`;
}

export type DemoConversation = {
  id: number;
  name: string;
  username: string;
  avatar: string;
  preview: string;
  time: string;
  unread: number;
};

export const demoConversations: DemoConversation[] = [
  {
    id: 1,
    name: "Maya Chen",
    username: "@mayawanders",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=85",
    preview: "That café looks perfect. Is there usually space to work after 2?",
    time: "2m",
    unread: 2,
  },
  {
    id: 2,
    name: "Jordan Lee",
    username: "@jordaneats",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=85",
    preview: "Tartine Saturday morning? I can get there before the line gets wild.",
    time: "18m",
    unread: 1,
  },
  {
    id: 3,
    name: "Priya Shah",
    username: "@priyaweekends",
    avatar:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&q=85",
    preview: "Let’s do the Ferry Building first, then walk up to Pier 39.",
    time: "1h",
    unread: 0,
  },
  {
    id: 4,
    name: "Eli Brooks",
    username: "@elibrooks",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=240&q=85",
    preview: "Replied to your post: the rooftop view is even better around 6:30.",
    time: "3h",
    unread: 0,
  },
  {
    id: 5,
    name: "Weekend Crew",
    username: "4 friends",
    avatar: commonsPhoto("Golden Gate Bridge, SF.jpg", 240),
    preview: "Nora: Weather looks clear Sunday — Twin Peaks or Ocean Beach?",
    time: "Yesterday",
    unread: 0,
  },
];

// ===== DEMO CONTENT END =====
