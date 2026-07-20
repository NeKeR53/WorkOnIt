import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { Board } from "../../lib/types";
import type { SourceDefinition } from "../../lib/backend-types";

export function MappingPane({
  source,
  board,
  active,
  onChange,
  onParse,
  onColumnMappingError,
}: {
  source: SourceDefinition;
  board: Board;
  active: boolean;
  onChange: (source: SourceDefinition) => void;
  onParse: () => void;
  onColumnMappingError: () => void;
}) {
  return (
    <section className={active ? "mapping-pane mobile-active" : "mapping-pane"}>
      <div className="pane-title">
        <strong>{copy("c100")}</strong>
        <span>{copy("c101")}</span>
      </div>
      <label>
        {copy("c021")}

        <input
          value={source.mapping.title}
          onChange={(event) =>
            onChange({
              ...source,
              mapping: { ...source.mapping, title: event.target.value },
            })
          }
        />
      </label>
      <label>
        {copy("c030")}

        <input
          value={source.mapping.description ?? ""}
          onChange={(event) =>
            onChange({
              ...source,
              mapping: {
                ...source.mapping,
                description: event.target.value || undefined,
              },
            })
          }
        />
      </label>
      <label>
        {copy("c102")}

        <input
          value={source.mapping.externalKey ?? ""}
          onChange={(event) =>
            onChange({
              ...source,
              mapping: {
                ...source.mapping,
                externalKey: event.target.value || undefined,
              },
            })
          }
        />
      </label>
      <label>
        {copy("c103")}

        <input
          value={source.mapping.column ?? ""}
          onChange={(event) =>
            onChange({
              ...source,
              mapping: {
                ...source.mapping,
                column: event.target.value || undefined,
              },
            })
          }
        />
      </label>
      {board && (
        <>
          <label>
            {copy("c104")}

            <select
              value={source.initialColumnId}
              onChange={(event) =>
                onChange({ ...source, initialColumnId: event.target.value })
              }
            >
              {board.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy("c105")}

            <textarea
              defaultValue={JSON.stringify(source.columnMapping, null, 2)}
              onBlur={(event) => {
                try {
                  onChange({
                    ...source,
                    columnMapping: JSON.parse(event.target.value) as Record<
                      string,
                      string
                    >,
                  });
                } catch {
                  onColumnMappingError();
                }
              }}
            />
          </label>
          {board.customFields
            .filter((field) => field.kind !== "secret")
            .map((field) => (
              <div key={field.id}>
                <label>
                  {copy("c359", { name: field.name })}
                  <input
                    value={source.customFieldMapping[field.id] ?? ""}
                    onChange={(event) => {
                      const customFieldMapping = {
                        ...source.customFieldMapping,
                      };
                      if (event.target.value)
                        customFieldMapping[field.id] = event.target.value;
                      else delete customFieldMapping[field.id];
                      onChange({ ...source, customFieldMapping });
                    }}
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={source.allowedUpdateCustomFields.includes(
                      field.id,
                    )}
                    onChange={(event) =>
                      onChange({
                        ...source,
                        allowedUpdateCustomFields: event.target.checked
                          ? [
                              ...new Set([
                                ...source.allowedUpdateCustomFields,
                                field.id,
                              ]),
                            ]
                          : source.allowedUpdateCustomFields.filter(
                              (id) => id !== field.id,
                            ),
                      })
                    }
                  />{" "}
                  {copy("c360", { name: field.name })}
                </label>
              </div>
            ))}
          <label className="check-row">
            <input
              type="checkbox"
              checked={source.allowedUpdateFields.includes("title")}
              onChange={(event) =>
                onChange({
                  ...source,
                  allowedUpdateFields: event.target.checked
                    ? [
                        ...new Set([
                          ...source.allowedUpdateFields,
                          "title" as const,
                        ]),
                      ]
                    : source.allowedUpdateFields.filter(
                        (field) => field !== "title",
                      ),
                })
              }
            />{" "}
            {copy("c106")}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={source.allowedUpdateFields.includes("description")}
              onChange={(event) =>
                onChange({
                  ...source,
                  allowedUpdateFields: event.target.checked
                    ? [
                        ...new Set([
                          ...source.allowedUpdateFields,
                          "description" as const,
                        ]),
                      ]
                    : source.allowedUpdateFields.filter(
                        (field) => field !== "description",
                      ),
                })
              }
            />{" "}
            {copy("c107")}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={source.moveExistingTasks}
              onChange={(event) =>
                onChange({
                  ...source,
                  moveExistingTasks: event.target.checked,
                })
              }
            />{" "}
            {copy("c108")}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={source.acceptPartial}
              onChange={(event) =>
                onChange({ ...source, acceptPartial: event.target.checked })
              }
            />{" "}
            {copy("c109")}
          </label>
          <label>
            {copy("c110")}

            <input
              type="number"
              min="1"
              value={source.absenceThreshold}
              onChange={(event) =>
                onChange({
                  ...source,
                  absenceThreshold: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            {copy("c111")}

            <input
              type="number"
              min="1"
              value={Math.round(source.outputLimitBytes / 1024 / 1024)}
              onChange={(event) =>
                onChange({
                  ...source,
                  outputLimitBytes: Number(event.target.value) * 1024 * 1024,
                })
              }
            />
          </label>
        </>
      )}
      {source.format === "text" && (
        <label>
          {copy("c112")}

          <input
            value={source.textPattern ?? ""}
            onChange={(event) =>
              onChange({ ...source, textPattern: event.target.value })
            }
          />
        </label>
      )}
      <button className="secondary-button" onClick={onParse}>
        <Icon name="preview" />
        {copy("c113")}
      </button>
    </section>
  );
}
