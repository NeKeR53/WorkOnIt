import { copy } from "../i18n";

export function BoardSkeleton() {
  return (
    <section
      className="board-skeleton"
      aria-label={copy("c016")}
      aria-busy="true"
    >
      {[0, 1, 2].map((column) => (
        <div key={column}>
          <span />
          {[0, 1, 2].map((card) => (
            <span key={card} />
          ))}
        </div>
      ))}
    </section>
  );
}
