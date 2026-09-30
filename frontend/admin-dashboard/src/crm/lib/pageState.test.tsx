/** Page state that survives navigation (29 Sep 2026): a tab lives in the
 *  address, each click is a history entry, Back / Forward re-read it, and a
 *  return without `?tab=` restores the tab last used on that record. */
import { useState as useState_ } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useChangeEffect, usePageTab, useSessionState } from "./pageState";

function go(search: string) {
  window.history.replaceState({}, "", `/admin/${search}`);
}

function Tabs() {
  const [tab, setTab] = usePageTab<string>("tab", "details", ["details", "applicants", "activity"]);
  return (
    <div>
      <p data-testid="tab">{tab}</p>
      {["details", "applicants", "activity"].map((k) => (
        <button key={k} type="button" onClick={() => setTab(k)}>{k}</button>
      ))}
    </div>
  );
}

describe("usePageTab", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    go("?view=crm&p=opportunities/12");
  });

  it("writes the default into the address so this history entry keeps it", () => {
    render(<Tabs />);
    expect(screen.getByTestId("tab").textContent).toBe("details");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("details");
  });

  it("pushes one history entry per click and Back returns to the previous tab", () => {
    render(<Tabs />);
    const before = window.history.length;
    fireEvent.click(screen.getByText("applicants"));
    expect(window.history.length).toBe(before + 1);
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("applicants");
    // Simulate the browser's Back: the address goes back, then popstate fires.
    act(() => {
      go("?view=crm&p=opportunities/12&tab=details");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("tab").textContent).toBe("details");
  });

  it("restores the last tab used on the same record when the address names none", () => {
    const first = render(<Tabs />);
    fireEvent.click(screen.getByText("activity"));
    first.unmount();
    go("?view=crm&p=opportunities/12");            // arrived again from the list
    render(<Tabs />);
    expect(screen.getByTestId("tab").textContent).toBe("activity");
  });

  it("does not carry a tab onto another record, and ignores a foreign value", () => {
    const first = render(<Tabs />);
    fireEvent.click(screen.getByText("activity"));
    first.unmount();
    go("?view=crm&p=opportunities/99&tab=nonsense");
    render(<Tabs />);
    expect(screen.getByTestId("tab").textContent).toBe("details");
  });
});

function Pager() {
  const [page, setPage] = useSessionState("page", 1);
  const [filter, setFilter] = useState_("a");
  useChangeEffect(() => { setPage(1); }, [filter]);
  return (
    <div>
      <p data-testid="page">{page}</p>
      <button type="button" onClick={() => setPage((p) => p + 1)}>next</button>
      <button type="button" onClick={() => setFilter("b")}>filter</button>
    </div>
  );
}
describe("useSessionState + useChangeEffect", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    go("?view=crm&p=customers");
  });

  it("keeps a list's page across a remount and only resets it on a real change", () => {
    const first = render(<Pager />);
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("page").textContent).toBe("3");
    first.unmount();
    render(<Pager />);                               // Back to the list
    expect(screen.getByTestId("page").textContent).toBe("3");
    fireEvent.click(screen.getByText("filter"));
    expect(screen.getByTestId("page").textContent).toBe("1");
  });
});
