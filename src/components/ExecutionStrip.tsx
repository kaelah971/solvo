const stripItems = [
  {
    index: "01",
    title: "Check",
    body: "Validate addresses, amounts and limits.",
  },
  {
    index: "02",
    title: "Execute",
    body: "Simulate and submit through KeeperHub.",
  },
  {
    index: "03",
    title: "Prove",
    body: "Return the hash and audit record.",
  },
] as const;

/**
 * The lower feature strip: one continuous row divided by hairlines, never
 * three separate cards.
 */
export function ExecutionStrip() {
  return (
    <div className="hairline-top hairline-bottom grid grid-cols-1 sm:grid-cols-3">
      {stripItems.map((item, index) => (
        <div
          key={item.index}
          className={`px-5 py-6 sm:px-7 [@media(max-height:500px)_and_(min-width:640px)]:!px-4 [@media(max-height:500px)_and_(min-width:640px)]:!py-2 ${
            index > 0 ? "border-t border-line sm:border-l sm:border-t-0" : ""
          }`}
        >
          <p className="font-data text-[11px] tracking-[0.08em] text-faint [@media(max-height:500px)_and_(min-width:640px)]:!text-[9px] [@media(max-height:500px)_and_(min-width:640px)]:!leading-none">
            {item.index}.
          </p>
          <h3 className="mt-3 text-[12px] font-semibold uppercase leading-[1.2] tracking-[0.2em] text-primary [@media(max-height:500px)_and_(min-width:640px)]:!mt-1 [@media(max-height:500px)_and_(min-width:640px)]:!text-[10px] [@media(max-height:500px)_and_(min-width:640px)]:!leading-none">
            {item.title}
          </h3>
          <p className="mt-2 text-[12px] leading-[1.5] tracking-[0.05em] text-muted [@media(max-height:500px)_and_(min-width:640px)]:!mt-1 [@media(max-height:500px)_and_(min-width:640px)]:!text-[10px] [@media(max-height:500px)_and_(min-width:640px)]:!leading-[1.25]">
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}
