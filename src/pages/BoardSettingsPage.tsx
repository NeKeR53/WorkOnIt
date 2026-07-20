import { copy } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { BoardSourcesSection } from "../components/board-settings/BoardSourcesSection";
import { ColumnsSection } from "../components/board-settings/ColumnsSection";
import { TransitionsSection } from "../components/board-settings/TransitionsSection";
import { CustomFieldsSection } from "../components/board-settings/CustomFieldsSection";
import { CardDisplaySection } from "../components/board-settings/CardDisplaySection";
import { type Board } from "../lib/types";

export function BoardSettingsPage({
  board,
  onBoard,
  onClose,
  onMessage,
}: {
  board: Board;
  onBoard: (board: Board) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  return (
    <>
      <PageHeader
        title={copy("c195")}
        description={board.name}
        actions={
          <button
            className="secondary-button"
            onClick={onClose}
            aria-label={copy("c181")}
          >
            <Icon name="arrow_back" />
            {copy("c181")}
          </button>
        }
      />
      <section
        className="content-page settings-page board-settings"
        aria-label={copy("c195")}
      >
        <div className="settings-grid">
          <BoardSourcesSection
            board={board}
            onBoard={onBoard}
            onMessage={onMessage}
          />
          <ColumnsSection board={board} onBoard={onBoard} />
          <TransitionsSection
            board={board}
            onBoard={onBoard}
            onMessage={onMessage}
          />
          <CustomFieldsSection
            board={board}
            onBoard={onBoard}
            onMessage={onMessage}
          />
          <CardDisplaySection
            board={board}
            onBoard={onBoard}
            onMessage={onMessage}
          />
        </div>
      </section>
    </>
  );
}
