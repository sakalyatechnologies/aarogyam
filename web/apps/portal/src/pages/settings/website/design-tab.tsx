import { RadioGroup } from "@sakalya/ui";

import { FONTS, TEMPLATES, TemplateThumbnail, fontPairing } from "@aarogyam/site-kit";

export interface Design {
  layout: "one" | "multi";
  template: string;
  palette: string;
  fonts: string;
}

/** Layout, design gallery with thumbnails, colour palette and fonts. Every change applies to the preview at once. */
export function DesignTab({ design, onChange }: { design: Design; onChange: (changes: Partial<Design>) => void }) {
  const current = TEMPLATES.find((t) => t.id === design.template) ?? TEMPLATES[0];
  return (
    <div className="wb-stack">
      <RadioGroup
        label="How many pages?"
        orientation="horizontal"
        value={design.layout}
        onValueChange={(layout) => {
          onChange({ layout });
        }}
        options={[
          { value: "one", label: "One page", hint: "Everything on one scrolling page" },
          { value: "multi", label: "Several pages", hint: "Home, About, Services, Gallery, Contact" },
        ]}
      />

      <fieldset className="wb-fieldset">
        <legend>Design</legend>
        <ul className="wb-templates">
          {TEMPLATES.map((template) => {
            const selected = template.id === design.template;
            const palette = selected ? design.palette : (template.palettes[0]?.id ?? "");
            return (
              <li key={template.id}>
                <button
                  type="button"
                  className="wb-template"
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) {
                      onChange({ template: template.id, palette: template.palettes[0]?.id ?? design.palette });
                    }
                  }}
                >
                  <TemplateThumbnail template={template.id} palette={palette} label={`${template.name} design`} />
                  <span className="wb-template-name">{template.name}</span>
                  <span className="wb-template-tag">{template.tagline}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="wb-fieldset">
        <legend>Colours</legend>
        <ul className="wb-swatches">
          {current?.palettes.map((palette) => (
            <li key={palette.id}>
              <button
                type="button"
                className="wb-swatch"
                aria-pressed={palette.id === design.palette}
                aria-label={`${palette.name} colours`}
                onClick={() => {
                  onChange({ palette: palette.id });
                }}
              >
                <span className="wb-swatch-chip" style={{ background: palette.bg }}>
                  <i style={{ background: palette.surface2 }} />
                  <i style={{ background: palette.accent }} />
                  <i style={{ background: palette.text }} />
                </span>
                <span>{palette.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <RadioGroup
        label="Fonts"
        value={design.fonts}
        onValueChange={(fonts) => {
          onChange({ fonts });
        }}
        options={FONTS.map((font) => ({ value: font.id, label: font.name, hint: fontPairing(font.id).sample }))}
      />
    </div>
  );
}
