import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Pagination from "./Pagination";

function renderPagination(props) {
  const onPageChange = jest.fn();
  render(
    <Pagination currentPage={1} totalPages={3} itemsPerPage={10} totalItems={25} onPageChange={onPageChange} {...props} />
  );
  return onPageChange;
}

const summary = () => screen.getByText(/showing/i).textContent.replace(/\s+/g, " ").trim();

test("shows the item range of the first page", () => {
  renderPagination();
  expect(summary()).toBe("Showing 1 to 10 of 25 results");
});

test("last page range is capped at the total", () => {
  renderPagination({ currentPage: 3 });
  expect(summary()).toBe("Showing 21 to 25 of 25 results");
});

test("renders a button per page", () => {
  renderPagination({ totalPages: 4, totalItems: 40 });
  for (const n of ["1", "2", "3", "4"]) expect(screen.getByRole("button", { name: n })).toBeInTheDocument();
});

test("Previous is disabled on the first page, Next is enabled", async () => {
  const onPageChange = renderPagination();
  expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  expect(onPageChange).toHaveBeenCalledWith(2);
});

test("Next is disabled on the last page, Previous goes back", async () => {
  const onPageChange = renderPagination({ currentPage: 3 });
  expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /previous/i }));
  expect(onPageChange).toHaveBeenCalledWith(2);
});

test("clicking a page number jumps to it", async () => {
  const onPageChange = renderPagination({ currentPage: 2 });
  await userEvent.click(screen.getByRole("button", { name: "3" }));
  expect(onPageChange).toHaveBeenCalledWith(3);
});

test("single page: both arrows disabled", () => {
  renderPagination({ totalPages: 1, totalItems: 4 });
  expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  expect(summary()).toBe("Showing 1 to 4 of 4 results");
});
