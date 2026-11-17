import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, buttonVariants } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import { Textarea } from "./textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./table";
import { DatePicker } from "./date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu";

describe("Button", () => {
  test("renders a button, forwards ref, merges classes and handles clicks", async () => {
    const ref = createRef();
    const onClick = jest.fn();
    render(
      <Button ref={ref} variant="outline" size="sm" className="extra" onClick={onClick}>
        Go
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(ref.current).toBe(btn);
    expect(btn).toHaveClass("border", "h-9", "extra");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  test("disabled button ignores clicks", async () => {
    const onClick = jest.fn();
    render(<Button disabled onClick={onClick}>No</Button>);
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test("asChild renders the child element instead of a button", () => {
    render(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>
    );
    expect(screen.getByRole("link", { name: "Link" })).toHaveAttribute("href", "/x");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("buttonVariants: tailwind conflicts resolve to the last class", () => {
    expect(buttonVariants({ size: "icon" })).toMatch(/h-10 w-10/);
    expect(buttonVariants({ variant: "destructive" })).toMatch(/bg-destructive/);
  });
});

describe("form primitives", () => {
  test("Label + Input are associated and typable", async () => {
    render(
      <>
        <Label htmlFor="n">Name</Label>
        <Input id="n" type="text" className="w-1" />
      </>
    );
    const input = screen.getByLabelText("Name");
    await userEvent.type(input, "Ada");
    expect(input).toHaveValue("Ada");
    expect(input).toHaveClass("w-1");
  });

  test("Textarea forwards ref and props", async () => {
    const ref = createRef();
    render(<Textarea ref={ref} placeholder="Notes" />);
    await userEvent.type(screen.getByPlaceholderText("Notes"), "hello");
    expect(ref.current.value).toBe("hello");
    expect(ref.current.tagName).toBe("TEXTAREA");
  });
});

test("Card renders all slots", () => {
  render(
    <Card data-testid="card">
      <CardHeader>
        <CardTitle>Title</CardTitle>
        <CardDescription>Desc</CardDescription>
      </CardHeader>
      <CardContent>Body</CardContent>
      <CardFooter>Foot</CardFooter>
    </Card>
  );
  const card = screen.getByTestId("card");
  for (const t of ["Title", "Desc", "Body", "Foot"]) expect(within(card).getByText(t)).toBeInTheDocument();
});

test("Table renders a semantic table", () => {
  render(
    <Table>
      <TableCaption>Caption</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Ada</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
  const table = screen.getByRole("table", { name: "Caption" });
  expect(within(table).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByRole("cell", { name: "Ada" })).toBeInTheDocument();
});

describe("DatePicker", () => {
  test("shows the date as YYYY-MM-DD", () => {
    render(<DatePicker date={new Date("2026-11-12")} onDateChange={() => {}} />);
    expect(screen.getByDisplayValue("2026-11-12")).toHaveAttribute("type", "date");
  });

  test("empty when no date", () => {
    const { container } = render(<DatePicker onDateChange={() => {}} placeholder="When?" />);
    const input = container.querySelector("input");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "When?");
  });

  test("picking a date calls onDateChange with a Date that round-trips to the same day", () => {
    const onDateChange = jest.fn();
    const { container } = render(<DatePicker onDateChange={onDateChange} />);
    fireEvent.change(container.querySelector("input"), { target: { value: "2026-01-31" } });
    const picked = onDateChange.mock.calls[0][0];
    expect(picked).toBeInstanceOf(Date);
    // Consumers store `date.toISOString().split("T")[0]`; it must be the picked day in any timezone.
    expect(picked.toISOString().split("T")[0]).toBe("2026-01-31");
  });

  test("clearing the input calls onDateChange(null)", () => {
    const onDateChange = jest.fn();
    const { container } = render(<DatePicker date={new Date("2026-11-12")} onDateChange={onDateChange} />);
    fireEvent.change(container.querySelector("input"), { target: { value: "" } });
    expect(onDateChange).toHaveBeenCalledWith(null);
  });

  test("disabled", () => {
    const { container } = render(<DatePicker disabled onDateChange={() => {}} />);
    expect(container.querySelector("input")).toBeDisabled();
  });

  test("an invalid date renders empty instead of crashing", () => {
    const { container } = render(<DatePicker date={new Date("not a date")} onDateChange={() => {}} />);
    expect(container.querySelector("input")).toHaveValue("");
  });
});

test("Popover opens its content on trigger click", async () => {
  render(
    <Popover>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Inside</PopoverContent>
    </Popover>
  );
  expect(screen.queryByText("Inside")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByText("Inside")).toBeInTheDocument();
});

test("Dialog opens, shows title/description and closes with the X", async () => {
  render(
    <Dialog>
      <DialogTrigger>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>Change things</DialogDescription>
        </DialogHeader>
        <DialogFooter>footer</DialogFooter>
      </DialogContent>
    </Dialog>
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit item" });
  expect(dialog).toHaveAccessibleDescription("Change things");
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("AlertDialog: Cancel closes, Action fires its handler", async () => {
  const onConfirm = jest.fn();
  render(
    <AlertDialog>
      <AlertDialogTrigger>Delete</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Cannot undo</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Yes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("alertdialog", { name: "Sure?" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(await screen.findByRole("button", { name: "Yes" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("DropdownMenu opens and selects an item", async () => {
  const onSelect = jest.fn();
  const onChecked = jest.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel inset>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSelect}>
          Rename <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={false} onCheckedChange={onChecked}>
          Pin
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  expect(await screen.findByRole("menu")).toBeInTheDocument();
  expect(screen.getByText("Actions")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
  expect(onSelect).toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Pin" }));
  expect(onChecked).toHaveBeenCalledWith(true);
});
