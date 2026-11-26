import { useState } from "react";
import { Maximize2, Minimize2, Search } from "lucide-react";
import guideMarkdown from "../../docs/ui-guide.md?raw";
import Modal from "./Modal";
import { guideFigures, type GuideFigure } from "./ui-guide-figures";
import "./ui-guide.css";

const guideGroups = guideMarkdown
  .split(/^## /m)
  .slice(1)
  .map((section) => {
    const [title, ...lines] = section.split("\n");
    const entries = lines
      .filter((line) => line.startsWith("| **"))
      .map((line) => {
        const [, name, description] = line.split("|");
        return {
          name: name.replaceAll("**", "").trim(),
          description: description.trim(),
        };
      });
    return { title, entries };
  });

function GuideDescription({ text }: { text: string }) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

function IllustratedView({ figure }: { figure: GuideFigure }) {
  const [enlarged, setEnlarged] = useState(false);
  return (
    <figure
      className={`ui-guide-figure${figure.width < figure.height * 1.2 ? " ui-guide-figure-narrow" : ""}`}
    >
      <div className="ui-guide-figure-header">
        <h3>{figure.title}</h3>
        <button
          className="text-button ui-guide-zoom"
          type="button"
          aria-pressed={enlarged}
          onClick={() => setEnlarged(!enlarged)}
        >
          {enlarged ? (
            <Minimize2 size={14} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} aria-hidden="true" />
          )}
          {enlarged ? "Fit image" : "Enlarge image"}
        </button>
      </div>
      <div
        className="ui-guide-image-scroll"
        role={enlarged ? "region" : undefined}
        aria-label={enlarged ? figure.title + " enlarged" : undefined}
        tabIndex={enlarged ? 0 : undefined}
      >
        <div
          className="ui-guide-image"
          style={{
            width: figure.width,
            minWidth: enlarged ? figure.width : undefined,
          }}
        >
          <img
            src={figure.src}
            width={figure.width}
            height={figure.height}
            alt={figure.alt}
          />
          {figure.labels.map(({ x, y, name }, index) => (
            <span
              key={name}
              className="ui-guide-marker"
              style={{
                left: `${(x / figure.width) * 100}%`,
                top: `${(y / figure.height) * 100}%`,
              }}
              aria-hidden="true"
            >
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      <figcaption>
        <ol>
          {figure.labels.map(({ name, hint }) => (
            <li key={name}>
              <strong>{name}</strong>
              <span>{hint}</span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

export default function UiGuide({
  phoneLayout,
  selectedView,
  onSelectView,
  onClose,
}: {
  phoneLayout: boolean;
  selectedView?: string;
  onSelectView: (view: string) => void;
  onClose: () => void;
}) {
  const views = [...guideFigures.map(({ tab }) => tab), "All names"];
  const slug = (label: string) => label.toLowerCase().replaceAll(" ", "-");
  const view = views.find((label) => slug(label) === selectedView) ?? (phoneLayout ? "Phone" : "Workspace");
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const figure = guideFigures.find(({ tab }) => tab === view);
  const matches = searching
    ? guideGroups
        .map(({ title, entries }) => ({
          title,
          entries: entries.filter(({ name, description }) => {
            const searchable =
              `${name} ${description.replaceAll("**", "")}`.toLowerCase();
            return words.every((word) => searchable.includes(word));
          }),
        }))
        .filter(({ entries }) => entries.length)
    : guideGroups;

  return (
    <Modal title="UI guide" wide className="ui-guide" onClose={onClose}>
      <label className="ui-guide-search">
        <span>Find a UI name</span>
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Try reply details or rack"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="ui-guide-views" role="group" aria-label="Guide views">
        {views.map((label) => (
          <button
            key={label}
            type="button"
            className="button secondary"
            aria-pressed={!searching && view === label}
            onClick={() => {
              onSelectView(slug(label));
              setQuery("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!searching && figure ? (
        <IllustratedView key={view} figure={figure} />
      ) : (
        <div className="ui-guide-glossary">
          {!matches.length && <p role="status">No matching UI names.</p>}
          {matches.map(({ title, entries }) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {entries.map(({ name, description }) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      <GuideDescription text={description} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
