import type { ContentItem, LiveRoom } from "@/api-client";

export function MomentTray({ items, liveRooms }: { items: ContentItem[]; liveRooms: LiveRoom[] }) {
  return (
    <section aria-label="Moments" className="moment-tray" id="moments">
      <a className="moment-create" href="/app/create?distribution=moment">
        <span className="moment-avatar moment-avatar-create" aria-hidden="true">+</span>
        <span>Your moment</span>
      </a>
      {liveRooms.map((room) => (
        <a className="moment-entry" href={`/live/${room.id}`} key={`live:${room.id}`}>
          <span className="moment-avatar moment-avatar-live" aria-hidden="true">
            {room.creator.avatarUrl ? <img alt="" src={room.creator.avatarUrl} /> : room.creator.displayName.slice(0, 1).toUpperCase()}
            <small>LIVE</small>
          </span>
          <span>{room.creator.handle}</span>
        </a>
      ))}
      {firstMomentPerCreator(items).map((item) => (
        <a className="moment-entry" href={`/app/moments?start=${encodeURIComponent(item.id)}`} key={item.id}>
          <span className="moment-avatar" aria-hidden="true">
            {item.creator.avatarUrl
              ? <img alt="" src={item.creator.avatarUrl} />
              : item.creator.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span>{item.creator.handle}</span>
        </a>
      ))}
    </section>
  );
}

function firstMomentPerCreator(items: ContentItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.creator.id)) return false;
    seen.add(item.creator.id);
    return true;
  });
}
