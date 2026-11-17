import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IssueFormModal from "./IssueFormModal";

const DRAFT = {
  position: [1, 2, 3],
  viewpoint: { position: [0, 0, 0], direction: [0, 0, -1] },
  element: { expressID: 55, type: "IFCWALL", globalId: "2O2Fr$t4X7Zf8NOew3FLOH" },
  snapshot: new Blob(["png"], { type: "image/png" }),
};

const ISSUE = {
  id: 4,
  number: 12,
  title: "Crack",
  description: "Hairline",
  status: "in_progress",
  priority: "high",
  assignee: 11,
  due_date: "2026-05-01",
  created_by_name: "Ravi",
  created_at: "2026-04-01T10:00:00Z",
  element_express_id: 77,
  element_type: "IFCSLAB",
  element_global_id: "",
  photo: "http://x/photo.jpg",
  snapshot: "http://x/snap.png",
};

const ASSIGNEES = [
  { id: 11, name: "Asha" },
  { id: 12, name: "Ben" },
];

beforeEach(() => {
  URL.createObjectURL = jest.fn(() => "blob:url");
  URL.revokeObjectURL = jest.fn();
});

function renderModal(props = {}) {
  const handlers = {
    onSave: jest.fn().mockResolvedValue(),
    onDelete: jest.fn().mockResolvedValue(),
    onClose: jest.fn(),
  };
  const utils = render(
    <IssueFormModal assignees={ASSIGNEES} bimId={2} {...handlers} {...props} />,
  );
  return { ...handlers, ...utils };
}

describe("new issue", () => {
  test("requires a title", async () => {
    const { onSave } = renderModal({ draft: DRAFT });
    expect(screen.getByText("New issue")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(screen.getByText("Give the issue a title.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("submits trimmed fields with the pick location, element and snapshot", async () => {
    const { onSave } = renderModal({ draft: DRAFT });
    expect(screen.getByText(/Pinned to/)).toHaveTextContent(
      "Pinned to IFCWALL #552O2Fr$t4X7Zf8NOew3FLOH", // id + monospace GlobalId span
    );
    expect(screen.getByAltText("3D viewpoint")).toHaveAttribute("src", "blob:url");
    await userEvent.type(screen.getByLabelText("Title"), "  Leak  ");
    await userEvent.type(screen.getByLabelText("Description"), "Water");
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "critical");
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "12");
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-07-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Create issue" }));

    expect(onSave).toHaveBeenCalledWith(
      {
        title: "Leak",
        description: "Water",
        status: "open",
        priority: "critical",
        assignee: "12",
        due_date: "2026-07-01",
        bim: 2,
        position: [1, 2, 3],
        viewpoint: DRAFT.viewpoint,
        element_express_id: 55,
        element_global_id: "2O2Fr$t4X7Zf8NOew3FLOH",
        element_type: "IFCWALL",
      },
      { photo: null, snapshot: DRAFT.snapshot },
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  test("a pick without an element or BIM sends nulls/blanks", async () => {
    const { onSave } = renderModal({
      draft: { position: [0, 0, 0], viewpoint: null, snapshot: null },
      bimId: undefined,
    });
    expect(screen.queryByText(/Pinned to/)).not.toBeInTheDocument();
    expect(screen.getAllByText("None")).toHaveLength(2);
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      assignee: null,
      due_date: null,
      bim: null,
      element_express_id: null,
      element_global_id: "",
      element_type: "",
    });
  });

  test("attaching a photo sends it", async () => {
    const { onSave, container } = renderModal({ draft: DRAFT });
    const photo = new File(["jpg"], "site.jpg", { type: "image/jpeg" });
    await userEvent.upload(container.ownerDocument.querySelector('input[type="file"]'), photo);
    expect(screen.getByText("Replace")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(onSave.mock.calls[0][1].photo).toBe(photo);
  });

  test.each([
    [{ response: { data: { error: "Not a member" } } }, "Not a member"],
    [
      { response: { data: { title: ["Too long."], position: "Bad" } } },
      "title: Too long. · position: Bad",
    ],
    [new Error("Network Error"), "Network Error"],
    [{}, "Could not save the issue."],
  ])("save failure %# shows an inline error", async (err, message) => {
    const onSave = jest.fn().mockRejectedValue(err);
    renderModal({ draft: DRAFT, onSave });
    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create issue" })).toBeEnabled();
  });

  test("Cancel, the X and a backdrop click close; clicks inside do not", async () => {
    const { onClose } = renderModal({ draft: DRAFT });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByLabelText("Title"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByText("New issue").closest("form").parentElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test("the draft snapshot URL is revoked on unmount", () => {
    const { unmount } = renderModal({ draft: DRAFT });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:url");
  });

  test("no delete button for a new issue", () => {
    renderModal({ draft: DRAFT });
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe("existing issue", () => {
  test("prefills fields and shows author, element and images", () => {
    renderModal({ issue: ISSUE });
    expect(screen.getByText("Issue #12")).toBeInTheDocument();
    expect(screen.getByText("by Ravi · 2026-04-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Crack");
    expect(screen.getByLabelText("Description")).toHaveValue("Hairline");
    expect(screen.getByLabelText("Status")).toHaveValue("in_progress");
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(screen.getByLabelText("Assignee")).toHaveValue("11");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-05-01");
    expect(screen.getByText(/Pinned to/)).toHaveTextContent("Pinned to IFCSLAB #77");
    expect(screen.getByAltText("Site photo")).toHaveAttribute("src", "http://x/photo.jpg");
    expect(screen.getByAltText("3D viewpoint")).toHaveAttribute("src", "http://x/snap.png");
  });

  test("edits send only form fields (no location) and no snapshot", async () => {
    const { onSave } = renderModal({ issue: ISSUE });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "resolved");
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(
      {
        title: "Crack",
        description: "Hairline",
        status: "resolved",
        priority: "high",
        assignee: null,
        due_date: "2026-05-01",
      },
      { photo: null, snapshot: null },
    );
  });

  test("removing the photo sends clear_photo", async () => {
    const { onSave } = renderModal({ issue: ISSUE });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByAltText("Site photo")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave.mock.calls[0][0].clear_photo).toBe(true);
  });

  test("an issue without element or optional fields uses defaults", () => {
    renderModal({ issue: { id: 1, number: 1, title: "x", element_express_id: null } });
    expect(screen.queryByText(/Pinned to/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("open");
    expect(screen.getByLabelText("Priority")).toHaveValue("normal");
    expect(screen.getByLabelText("Assignee")).toHaveValue("");
    expect(screen.queryByText(/^by /)).not.toBeInTheDocument();
  });

  test("delete asks for confirmation", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    const { onDelete } = renderModal({ issue: ISSUE });
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(confirm).toHaveBeenCalledWith("Delete issue #12?");
    expect(onDelete).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalled();
  });

  test.each([
    [{ response: { data: { error: "Only the issue's creator or an admin can delete it." } } },
      "Only the issue's creator or an admin can delete it."],
    [new Error("x"), "Could not delete the issue."],
  ])("delete failure %# is shown", async (err, message) => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const onDelete = jest.fn().mockRejectedValue(err);
    renderModal({ issue: ISSUE, onDelete });
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Delete/ })).toBeEnabled());
  });
});
