import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown, applyFormat, parseMarkdown, validateMarkdown } from "./index.js";

describe("Markdown renderer", () => {
  it("renders headings, lists, bold and italic as elements", () => {
    const { container } = render(<Markdown text={"## Plan\n- **RCT** on 36\n- *review* soon\n\n1. First\n2. Second\n\nPlain line"} />);
    expect(container.querySelector("h4")?.textContent).toBe("Plan");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("ul strong")?.textContent).toBe("RCT");
    expect(container.querySelector("ul em")?.textContent).toBe("review");
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("p")?.textContent).toBe("Plain line");
  });

  it("shows markup typed into a note as plain characters, never as HTML", () => {
    const hostile = '<img src=x onerror="alert(1)"> <script>alert(2)</script> [x](javascript:alert(3)) ![y](http://e/a.png)';
    const { container } = render(<Markdown text={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(2)</script>");
    expect(container.textContent).toContain("[x](javascript:alert(3))");
  });

  it("leaves unmatched markers and deeper headings as text", () => {
    expect(parseMarkdown("#### too deep")).toEqual([{ type: "paragraph", children: [{ type: "text", text: "#### too deep" }] }]);
    const { container } = render(<Markdown text="2 * 3 = 6 and a_b_c and **open" />);
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("2 * 3 = 6 and a_b_c and **open");
  });
});

describe("validateMarkdown", () => {
  it("accepts the subset and plain comparisons", () => {
    expect(validateMarkdown("## Plan\n- **RCT**\nBP < 120 and x<3")).toBeUndefined();
  });

  it("refuses HTML, links, images, code and deep headings, as the API does", () => {
    for (const bad of ["<b>x</b>", "<!-- c -->", "[x](http://e)", "![x](http://e)", "`code`", "#### deep"]) {
      expect(validateMarkdown(bad), bad).toBeTypeOf("string");
    }
  });
});

describe("applyFormat", () => {
  it("wraps and unwraps a selection in bold", () => {
    const bold = applyFormat("take rest now", 5, 9, "bold");
    expect(bold).toEqual({ value: "take **rest** now", start: 7, end: 11 });
    expect(applyFormat(bold.value, bold.start, bold.end, "bold").value).toBe("take rest now");
  });

  it("turns lines into a numbered list and back, and toggles a heading", () => {
    const list = applyFormat("one\ntwo", 0, 7, "numbers");
    expect(list.value).toBe("1. one\n2. two");
    expect(applyFormat(list.value, list.start, list.end, "numbers").value).toBe("one\ntwo");
    expect(applyFormat("Plan", 0, 0, "heading").value).toBe("## Plan");
    expect(applyFormat("## Plan", 0, 0, "heading").value).toBe("Plan");
    expect(applyFormat("a\nb", 2, 3, "bullets").value).toBe("a\n- b");
  });
});
