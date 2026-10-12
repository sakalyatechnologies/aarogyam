/** The editable lines of a visit's bill: price, quantity, remove, add from the price list or by hand, a discount, and the live total. */
import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import type { PriceItem } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Select } from "@sakalya/ui";

import { lineFromPrice, lineTotal, newKey, subtotalOf, type BillLine } from "./bill-lines.js";
import { PillButton } from "./kit.js";
import "./bill-lines.css";

export function BillEditor({
  lines,
  onLines,
  discount,
  onDiscount,
  priceList,
  total,
  problem,
}: {
  lines: readonly BillLine[];
  onLines: (next: BillLine[]) => void;
  discount: string;
  onDiscount: (next: string) => void;
  priceList: readonly PriceItem[];
  total: number;
  problem: string | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const focusKey = useRef<string | undefined>(undefined);
  const change = (key: string, patch: Partial<BillLine>) => {
    onLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };
  const options = priceList.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} · ${formatRupees(p.price_paise)}` }));

  return (
    <div className="p360-bill">
      <ul className="p360-bill-lines" aria-label="Bill lines">
        {lines.map((line) => {
          const name = line.description.trim() === "" ? "new line" : line.description;
          const fromList = line.listPrice !== undefined;
          return (
            <li key={line.key} className="p360-bill-line">
              <div className="p360-bill-what">
                <input
                  className="p360-bill-in"
                  aria-label={`Description of ${name}`}
                  value={line.description}
                  placeholder="What it is for"
                  ref={(node) => {
                    if (node !== null && focusKey.current === line.key) {
                      focusKey.current = undefined;
                      node.focus();
                    }
                  }}
                  onChange={(event) => {
                    change(line.key, { description: event.currentTarget.value });
                  }}
                />
                <span className="mk-hint p360-bill-sub">
                  {line.tooth === undefined ? null : <b>Tooth {line.tooth}</b>}
                  {line.tooth !== undefined && fromList ? " · " : null}
                  {fromList ? (line.price === line.listPrice ? "from price list" : `price list ₹${line.listPrice ?? ""}`) : null}
                </span>
              </div>
              <input
                className="p360-bill-in p360-bill-qty"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={`Quantity of ${name}`}
                value={line.qty}
                onChange={(event) => {
                  change(line.key, { qty: Math.max(1, Math.floor(Number(event.currentTarget.value) || 1)) });
                }}
              />
              <input
                className="p360-bill-in p360-bill-price"
                inputMode="decimal"
                aria-label={`Price of ${name} (₹)`}
                value={line.price}
                placeholder="0"
                onChange={(event) => {
                  change(line.key, { price: event.currentTarget.value });
                }}
              />
              <span className="p360-bill-amt">
                {formatRupees(lineTotal(line))}
              </span>
              <button
                type="button"
                className="p360-bill-x"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  onLines(lines.filter((l) => l.key !== line.key));
                }}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="p360-bill-add">
          <Select
            aria-label="Add from the price list"
            placeholder="Pick from the price list"
            options={options}
            value=""
            onValueChange={(id) => {
              const item = priceList.find((p) => p.id === id);
              if (item !== undefined) onLines([...lines, lineFromPrice(item)]);
              setAdding(false);
            }}
          />
          <PillButton
            variant="ghost"
            onClick={() => {
              const key = newKey();
              focusKey.current = key;
              onLines([...lines, { key, description: "", qty: 1, price: "", gstRate: 0 }]);
              setAdding(false);
            }}
          >
            Type your own
          </PillButton>
        </div>
      ) : (
        <PillButton
          variant="ghost"
          icon={<Plus aria-hidden="true" />}
          onClick={() => {
            setAdding(true);
          }}
        >
          Add line
        </PillButton>
      )}
      <div className="p360-bill-sum">
        <span>Subtotal</span>
        <span>{formatRupees(subtotalOf(lines))}</span>
        <label htmlFor="p360-bill-discount">Discount (₹)</label>
        <input
          id="p360-bill-discount"
          className="p360-bill-in p360-bill-price"
          inputMode="decimal"
          placeholder="0"
          value={discount}
          onChange={(event) => {
            onDiscount(event.currentTarget.value);
          }}
        />
        <b>Total</b>
        <b aria-live="polite" data-testid="bill-total">
          {formatRupees(total)}
        </b>
      </div>
      {problem === undefined ? null : (
        <p className="mk-hint" role="status" style={{ margin: 0 }}>
          {problem}
        </p>
      )}
    </div>
  );
}
